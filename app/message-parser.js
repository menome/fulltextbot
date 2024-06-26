"use strict";
const queryBuilder = require('./queryBuilder');
const textract = require('textract');
const RabbitClient = require('@menome/botframework/rabbitmq');
const truncate = require("truncate-utf8-bytes");
const helpers = require('./helpers');
const natural = require("natural")
const pdfTextExtract = require( 'pdf-text-extract' )

const textGenerationMimeBlacklist = ['image/png', 'image/jpeg', 'image/gif'];

module.exports = function(bot) {
  var outQueue = new RabbitClient(bot.config.get('rabbit_outgoing'));
  outQueue.connect();

  // First ingestion point.
  this.handleMessage = function(msg) {
    var tmpPath = "/tmp/"+msg.Uuid;
    return processMessage(msg).then((resultStr) => {      
      var newRoute = helpers.getNextRoutingKey(resultStr, bot);

      if(newRoute === false || newRoute === undefined) {
        helpers.deleteFile(tmpPath);
        return bot.logger.info("No next routing key.");
      }

      if(typeof newRoute === "string") {
        bot.logger.info("Next routing key", {routingKey: newRoute})
        return outQueue.publishMessage(msg, "fileProcessingMessage", {routingKey: newRoute});
      }
      else if(Array.isArray(newRoute)) {
        bot.logger.info("Next routing keys",{routingKey: newRoute.join(', ')})
        newRoute.forEach((rkey) => {
          return outQueue.publishMessage(msg, "fileProcessingMessage", {routingKey: rkey});
        })
      }
    }).catch((err) => {
      bot.logger.error("error processing message",{error:err,msg:msg});
      helpers.deleteFile(tmpPath);
    })
  }

  //////////////////////////////
  // Internal/Helper functions

  function processMessage(msg) {
    var mimetype = msg.Mime;
    if(!mimetype) mimetype = "application/octet-stream";
    var tmpPath = "/tmp/"+msg.Uuid;

    return helpers.getFile(bot, msg.Library, msg.Path, tmpPath).then((tmpPath) => {
      // bot.logger.info("Attempting Text Extraction for summarization from file '%s'", msg.Path)
      return extractFulltext(mimetype, tmpPath).then(async (extracted) => {
        let pageTextQuery = false;
        let fulltext = extracted;
        let pageKeywordArray = [];
        let pageWordCountArray = [];
        let correctSpellingRatioArray = [];

        if(Array.isArray(extracted)) {
          let tokenizer = new natural.WordTokenizer();
          extracted.forEach((pageText, pageno) => {
            let tokens = tokenizer.tokenize(pageText);
            pageWordCountArray[pageno] = tokens.length;
            pageKeywordArray[pageno] = helpers.removeStopWordsFromArray(natural.LancasterStemmer.tokenizeAndStem(pageText)).join(" ");
            correctSpellingRatioArray[pageno] = helpers.spellCheckList(tokens) / pageWordCountArray[pageno];
          })

          pageTextQuery = queryBuilder.fulltextPageQuery({
            uuid: msg.Uuid, 
            pageTextArray: extracted, 
            pageKeywordArray, pageWordCountArray, correctSpellingRatioArray
          });
          fulltext = truncate(extracted.join(" "), 30000);

          await bot.neo4j.query(pageTextQuery.compile(), pageTextQuery.params()).then(() => {
            bot.logger.info("Added fulltext of pages to file", {path:msg.Path});
          })
        }

        let tokenizer = new natural.WordTokenizer();
        let tokens = tokenizer.tokenize(fulltext);

        let trimmedFulltext = helpers.removeStopWordsFromArray(natural.LancasterStemmer.tokenizeAndStem(fulltext)).join(" ")
        if(fulltext === false) return;
        if(fulltext.trim() === "") {
          return "empty-"+mimetype;
        }
        let wordcount = tokens.length;
        let totalSpelledCorrectly = helpers.spellCheckList(tokens)
        let correctSpellingRatio = totalSpelledCorrectly / wordcount;

        var fulltextQuery = queryBuilder.fulltextQuery({uuid: msg.Uuid, fulltext, fulltextKeywords: trimmedFulltext, wordcount, 
          correctSpellingRatio: correctSpellingRatio !== 0 ? correctSpellingRatio : undefined});

        return bot.neo4j.query(fulltextQuery.compile(), fulltextQuery.params()).then(() => {
          bot.logger.info("Added fulltext to file", {path:msg.Path});
          return "success";
        })
      }).catch(err => {
        bot.logger.error("error extracting text",{error:err})
        return "empty-"+mimetype;
      })
    })
  }

  // Extracts summary text from file.
  function extractFulltext(mimetype, file) {
    if(textGenerationMimeBlacklist.indexOf(mimetype) === -1) {
      return new Promise(function(resolve, reject) {
        if(bot.config.get("paginate") && mimetype === "application/pdf") {
          pdfTextExtract(file, { layout: 'raw' }, function(error, pageArray) {
            if(error) return reject(error);
            return resolve(pageArray)
          })
        } else {
          textract.fromFileWithMimeAndPath(mimetype, file, {
            pdftotextOptions: {
              layout: "raw",
              splitPages: true
            }
          }, function( error, text ) {
            if(error) return reject(error);
            return resolve(truncate(text, 30000));
          })
        }
      });
    }
    else {
      bot.logger.info("Not a fulltext-extractable MIME type. Skipping.",{mimeType:mimetype,file:file})
      return Promise.resolve(false);
    }
  }
}
