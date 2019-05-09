"use strict";
const queryBuilder = require('./queryBuilder');
const textract = require('textract');
const RabbitClient = require('@menome/botframework/rabbitmq');
const truncate = require("truncate-utf8-bytes");
const helpers = require('./helpers');
const natural = require("natural")

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
        bot.logger.info("Next routing key is '%s'", newRoute)
        return outQueue.publishMessage(msg, "fileProcessingMessage", {routingKey: newRoute});
      }
      else if(Array.isArray(newRoute)) {
        bot.logger.info("Next routing keys are '%s'", newRoute.join(', '))
        newRoute.forEach((rkey) => {
          return outQueue.publishMessage(msg, "fileProcessingMessage", {routingKey: rkey});
        })
      }
    }).catch((err) => {
      bot.logger.error(err);
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
      return extractFulltext(mimetype, tmpPath).then((fulltext) => {
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
          bot.logger.info("Added fulltext to file %s", msg.Path);
          return "success";
        })
      }).catch(err => {
        bot.logger.error(err)
        return "empty-"+mimetype;
      })
    })
  }

  // Extracts summary text from file
  function extractFulltext(mimetype, file) {
    if(textGenerationMimeBlacklist.indexOf(mimetype) === -1) {
      return new Promise(function(resolve, reject) {
        textract.fromFileWithMimeAndPath(mimetype, file, function( error, text ) {
          if(error) return reject(error);
          return resolve(truncate(text, 30000));
        })
      });
    }
    else {
      bot.logger.info("Not a fulltext-extractable MIME type. Skipping.")
      return Promise.resolve(false);
    }
  }
}
