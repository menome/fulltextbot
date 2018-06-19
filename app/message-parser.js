"use strict";
const queryBuilder = require('./queryBuilder');
const textract = require('textract');
const RabbitClient = require('@menome/botframework/rabbitmq');
var truncate = require("truncate-utf8-bytes");

var textGenerationMimeBlacklist = ['image/png', 'image/jpeg', 'image/gif'];

module.exports = function(bot) {
  var outQueue = new RabbitClient(bot.config.get('rabbit_outgoing'));
  outQueue.connect();

  // First ingestion point.
  this.handleMessage = function(msg) {
    var mimetype = msg.Mime;
    if(!mimetype) mimetype = "application/octet-stream";

    return bot.librarian.download(msg.Library, msg.Path, "/tmp/"+msg.Uuid).then((tmpPath) => {
      // bot.logger.info("Attempting Text Extraction for summarization from file '%s'", msg.Path)
      return extractFulltext(mimetype, tmpPath).then((fulltext) => {
        if(fulltext === false) return;
        var fulltextQuery = queryBuilder.fulltextQuery(msg.Uuid, fulltext);

        return bot.neo4j.query(fulltextQuery.compile(), fulltextQuery.params()).then((result) => {
          console.log("Done did it");
        })
      }).catch(err => {
        bot.logger.error("HELLA", err)
      })
    })
  }

  //////////////////////////////
  // Internal/Helper functions

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
