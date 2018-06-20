"use strict";
const queryBuilder = require('./queryBuilder');
const textract = require('textract');
const RabbitClient = require('@menome/botframework/rabbitmq');
const truncate = require("truncate-utf8-bytes");
const helpers = require('./helpers');

const textGenerationMimeBlacklist = ['image/png', 'image/jpeg', 'image/gif'];

module.exports = function(bot) {
  var outQueue = new RabbitClient(bot.config.get('rabbit_outgoing'));
  outQueue.connect();

  // First ingestion point.
  this.handleMessage = function(msg) {
    var tmpPath = "/tmp/"+msg.Uuid;
    return processMessage(msg).then((resultStr) => {
      var downstream_actions = bot.config.get('downstream_actions');
      var newRoutingKey = downstream_actions[resultStr];

      bot.logger.info("Next routing key is '%s'", newRoutingKey)

      if(newRoutingKey === false) return helpers.deleteFile(tmpPath);
      else if(newRoutingKey === undefined) return helpers.deleteFile(tmpPath);
      else return outQueue.publishMessage(msg, undefined, {routingKey: newRoutingKey});
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
        if(fulltext === false) return;
        var fulltextQuery = queryBuilder.fulltextQuery(msg.Uuid, fulltext);

        return bot.neo4j.query(fulltextQuery.compile(), fulltextQuery.params()).then(() => {
          bot.logger.info("Added fulltext to file %s", msg.Path);
          return "success";
        })
      }).catch(err => {
        bot.logger.error(err)
        return "error";
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
