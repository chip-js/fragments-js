var formatter = require('../binding').formatter;

// # Default Formatters

formatter.register('tokenList', function(value) {

  if (Array.isArray(value)) {
    return value.join(' ');
  }

  if (value && typeof value === 'object') {
    var classes = [];
    Object.keys(value).forEach(function(className) {
      if (value[className]) {
        classes.push(className);
      }
    });
    return classes.join(' ');
  }

  return value || '';
});

// v TODO v
formatter.register('styles', function(value) {

  if (Array.isArray(value)) {
    return value.join(' ');
  }

  if (value && typeof value === 'object') {
    var classes = [];
    Object.keys(value).forEach(function(className) {
      if (value[className]) {
        classes.push(className);
      }
    });
    return classes.join(' ');
  }

  return value || '';
});


// ## filter
// Filters an array by the given filter function(s), may provide a function, an
// array, or an object with filtering functions
formatter.register('filter', function(value, filterFunc) {
  if (!Array.isArray(value)) {
    return [];
  } else if (!filterFunc) {
    return value;
  }

  if (typeof filterFunc === 'function') {
    value = value.filter(filterFunc, this);
  } else if (Array.isArray(filterFunc)) {
    filterFunc.forEach(function(func) {
      value = value.filter(func, this);
    });
  } else if (typeof filterFunc === 'object') {
    Object.keys(filterFunc).forEach(function(key) {
      var func = filterFunc[key];
      if (typeof func === 'function') {
        value = value.filter(func, this);
      }
    });
  }
  return value;
});

// ## map
// Adds a formatter to map an array or value by the given mapping function
formatter.register('map', function(value, mapFunc) {
  if (value == null || typeof mapFunc !== 'function') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(mapFunc, this);
  } else {
    return mapFunc.call(this, value);
  }
});

// ## reduce
// Adds a formatter to reduce an array or value by the given reduce function
formatter.register('reduce', function(value, reduceFunc, initialValue) {
  if (value == null || typeof mapFunc !== 'function') {
    return value;
  }
  if (Array.isArray(value)) {
    if (arguments.length === 3) {
      return value.reduce(reduceFunc, initialValue);
    } else {
      return value.reduce(reduceFunc);
    }
  } else if (arguments.length === 3) {
    return reduceFunc(initialValue, value);
  }
});

// ## reduce
// Adds a formatter to reduce an array or value by the given reduce function
formatter.register('slice', function(value, index, endIndex) {
  if (Array.isArray(value)) {
    return value.slice(index, endIndex);
  } else {
    return value;
  }
});


// ## date
// Adds a formatter to format dates and strings
formatter.register('date', function(value) {
  if (!value) {
    return '';
  }

  if (!(value instanceof Date)) {
    value = new Date(value);
  }

  if (isNaN(value.getTime())) {
    return '';
  }

  return value.toLocaleString();
});


// ## log
// Adds a formatter to log the value of the expression, useful for debugging
formatter.register('log', function(value, prefix) {
  if (prefix == null) prefix = 'Log:';
  console.log(prefix, value);
  return value;
});


// ## limit
// Adds a formatter to limit the length of an array or string
formatter.register('limit', function(value, limit) {
  if (value && typeof value.slice === 'function') {
    if (limit < 0) {
      return value.slice(limit);
    } else {
      value.slice(0, limit);
    }
  } else {
    return value;
  }
});


// ## sort
// Sorts an array given a field name or sort function, and a direction
formatter.register('sort', function(value, sortFunc, dir) {
  if (!sortFunc || !Array.isArray(value)) {
    return value;
  }
  dir = (dir === 'desc') ? -1 : 1;
  if (typeof sortFunc === 'string') {
    var parts = sortFunc.split(':');
    var prop = parts[0];
    var dir2 = parts[1];
    dir2 = (dir2 === 'desc') ? -1 : 1;
    dir = dir || dir2;
    var sortFunc = function(a, b) {
      if (a[prop] > b[prop]) return dir;
      if (a[prop] < b[prop]) return -dir;
      return 0;
    };
  } else if (dir === -1) {
    var origFunc = sortFunc;
    sortFunc = function(a, b) { return -origFunc(a, b); };
  }

  return value.slice().sort(sortFunc);
});


// ## addQuery
// Takes the input URL and adds (or replaces) the field in the query
formatter.register('addQuery', function(value, queryField, queryValue) {
  var url = value || location.href;
  var parts = url.split('?');
  url = parts[0];
  var query = parts[1];
  var addedQuery = '';
  if (queryValue != null) {
    addedQuery = queryField + '=' + encodeURIComponent(queryValue);
  }

  if (query) {
    var expr = new RegExp('\\b' + queryField + '=[^&]*');
    if (expr.test(query)) {
      query = query.replace(expr, addedQuery);
    } else if (addedQuery) {
      query += '&' + addedQuery;
    }
  } else {
    query = addedQuery;
  }
  if (query) {
    url += '?' + query;
  }
  return url;
});


var div = document.createElement('div')
function escapeHTML(value) {
  div.textContent = value || '';
  return div.innerHTML;
}

// ## escape
// HTML escapes content. For use with other HTML-adding formatters such as autolink.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | escape | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</div>
// ```
formatter.register('escape', escapeHTML);


// ## p
// HTML escapes content wrapping paragraphs in <p> tags.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | p | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div><p>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</p>
// <p>It's great</p></div>
// ```
formatter.register('p', function(value) {
  var lines = (value || '').split(/\r?\n/);
  var escaped = lines.map(function(line) { return escapeHTML(line) || '<br>'; });
  return '<p>' + escaped.join('</p><p>') + '</p>';
});


// ## br
// HTML escapes content adding <br> tags in place of newlines characters.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | br | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!<br>
// It's great</div>
// ```
formatter.register('br', function(value) {
  var lines = (value || '').split(/\r?\n/);
  return lines.map(escapeHTML).join('<br>');
});


// ## newline
// HTML escapes content adding <p> tags at double newlines and <br> tags in place of single newline characters.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | newline | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div><p>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!<br>
// It's great</p></div>
// ```
formatter.register('newline', function(value) {
  var paragraphs = (value || '').split(/\r?\n\s*\r?\n/);
  var escaped = paragraphs.map(function(paragraph) {
    var lines = paragraph.split(/\r?\n/);
    return lines.map(escapeHTML).join('<br>');
  });
  return '<p>' + escaped.join('</p><p>') + '</p>';
});


// ## autolink
// Adds automatic links to escaped content (be sure to escape user content). Can be used on existing HTML content as it
// will skip URLs within HTML tags. Passing true in the second parameter will set the target to `_blank`.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | escape | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</div>
// ```
var urlExp = /(^|\s|\()((?:https?|ftp):\/\/[\-A-Z0-9+\u0026@#\/%?=()~_|!:,.;]*[\-A-Z0-9+\u0026@#\/%=~(_|])/gi;

formatter.register('autolink', function(value, target) {
  target = (target) ? ' target="_blank"' : '';

  return ('' + value).replace(/<[^>]+>|[^<]+/g, function(match) {
    if (match.charAt(0) === '<') {
      return match;
    }
    return match.replace(urlExp, '$1<a href="$2"' + target + '>$2</a>');
  });
});


formatter.register('int', function(value) {
  value = parseInt(value);
  return isNaN(value) ? null : value;
});


formatter.register('float', function(value) {
  value = parseFloat(value);
  return isNaN(value) ? null : value;
});


formatter.register('bool', function(value) {
  return value && value !== '0' && value !== 'false';
});
