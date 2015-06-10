module.exports = codifyExpression;

var oneBoundExpr = /^{{(.*?)}}$/;
var boundExpr = /{{(.*?)}}/g;

// Converts an inverted expression from `/user/{{user.id}}` to `"/user/" + user.id`
function codifyExpression(text) {
  if (oneBoundExpr.test(text)) {
    return text.replace(oneBoundExpr, '$1');
  } else {
    text = '"' + text.replace(boundExpr, function(match, text) {
      return '" + (' + text + ' || "") + "';
    }) + '"';
    return text.replace(/^"" \+ | "" \+ | \+ ""$/g, '');
  }
}
