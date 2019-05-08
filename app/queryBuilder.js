var Query = require('decypher').Query;

module.exports = {}

/**
 * Returns a query that updates the given file node with an absolute fuckpile of text
 * in an indexed property.
 */
module.exports.fulltextQuery = function(uuid, fulltext, fulltextKeywords) {
  var query = new Query();
  query.match("(f:Card {Uuid: {uuid}})", {uuid: uuid})
  query.set("f.FullText = {fulltext}",{fulltext: fulltext})
  if(fulltextKeywords) {
    query.set("f.FullTextKeywords = $fulltextKeywords",{fulltextKeywords: fulltextKeywords})
  }
  return query;
}