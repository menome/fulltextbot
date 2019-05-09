var Query = require('decypher').Query;

module.exports = {}

/**
 * Returns a query that updates the given file node with an absolute fuckpile of text
 * in an indexed property.
 */
module.exports.fulltextQuery = function({uuid, fulltext, fulltextKeywords, wordcount}) {
  var query = new Query();
  query.match("(f:Card {Uuid: {uuid}})", {uuid})
  query.set("f.FullText = {fulltext}", {fulltext})
  if(fulltextKeywords) query.set("f.FullTextKeywords = $fulltextKeywords", {fulltextKeywords})
  if(wordcount) query.set("f.WordCount = $wordcount", {wordcount})
  return query;
}