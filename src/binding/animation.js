// TODO update comment docs with new method. CSS transitions using `animate="fade"`. Or JavaScript animations using
// hooks `willAnimateIn()`, `animateIn(callback)`, and `didAnimateIn()`.

// The following 5 methods are helper DOM methods that allow registered bindings to work with CSS transitions for
// animating elements. If an element has the `animate` attribute or a matching JavaScript method, these helper methods
// will set a class on the node to trigger the animation and/or call the JavaScript methods to handle it.

// An animation may be either a CSS transition, a CSS animation, or a set of JavaScript methods that will be called.

// If using CSS, classes are added and removed from the element. When an element is inserted it will receive the `will-
// animate-in` class before being added to the DOM, then it will receive the `animate-in` class immediately after being
// added to the DOM, then both clases will be removed after the animation is complete. When an element is being removed
// from the DOM it will receive the `will-animate-out` and `animate-out` classes, then the classes will be removed once
// the animation is complete.

// If using JavaScript, methods must be defined  to animate the element there are 3 supported methods which can b

// TODO cache by class-name (Angular)? Only support javascript-style (Ember)? Add a `will-animate-in` and
// `did-animate-in` etc.?
// IF has any classes, add the `will-animate-in|out` and get computed duration. If none, return. Cache.
// RULE is use unique class to define an animation. Or attribute `animate="fade"` will add the class?
// `.fade.will-animate-in`, `.fade.animate-in`, `.fade.will-animate-out`, `.fade.animate-out`

// Events will be triggered on the elements named the same as the class names (e.g. `animate-in`) which may be listened
// to in order to cancel an animation or respond to it.

// If the node has methods `animateIn(done)`, `animateOut(done)`, `animateMoveIn(done)`, or `animateMoveOut(done)`
// defined on them then the helpers will allow an animation in JavaScript to be run and wait for the `done` function to
// be called to know when the animation is complete.

// Be sure to actually have an animation defined for elements with the `animate` class/attribute because the helpers use
// the `transitionend` and `animationend` events to know when the animation is finished, and if there is no animation
// these events will never be triggered and the operation will never complete.
exports.replaceNode = replaceNode;
exports.removeNode = removeNode;
exports.insertNodeBefore = insertNodeBefore;
exports.insertNodeAfter = insertNodeAfter;
exports.moveNode = moveNode;
exports.addTransitionEndListener = addTransitionEndListener;
exports.removeTransitionEndListener = removeTransitionEndListener;


// Helper method to replace a node in the DOM with another node, allowing for animations to occure. `callback` will be
// called when finished.
function replaceNode(node, withNode, callback) {
  animate.call(this, 'out', node, function() {
    node.parentNode.replaceChild(withNode, node);
    animate.call(this, 'in', withNode, callback, this);
  });
};

// Helper method to remove a node from the DOM, allowing for animations to occure. `callback` will be called when
// finished.
function removeNode(node, callback) {
  if (!node) {
    if (callback) callback.call(this);
    return;
  }
  animate.call(this, 'out', node, function() {
    node.parentNode.removeChild(node);
    if (callback) callback.call(this);
  });
};

// Helper method to insert a node in the DOM before another node, allowing for animations to occure. `callback` will be
// called when finished.
function insertNodeBefore(node, before, callback) {
  before.parentNode.insertBefore(node, before);
  animate.call(this, 'in', node, callback, this);
};

// Helper method to insert a node in the DOM after another node, allowing for animations to occure. `callback` will be
// called when finished.
function insertNodeAfter(node, after, callback) {
  after.parentNode.insertBefore(node, after.nextSibling);
  animate.call(this, 'in', node, callback, this);
};

// Helper method to move a node within its parent to the location before the given `before` node, or at the end if
// `before` is `null`, allowing for animations to occure. `callback` will be called when finished.
function moveNode(node, index, callback) {
  animate.call(this, 'move-out', node, function() {
    node.parentNode.insertBefore(node, before);
    animate.call(this, 'move-in', node, callback, this);
  });
};


var ANIMATIONS = [ 'in', 'out', 'move-in', 'move-out' ];

ANIMATIONS.forEach(function(key) {
  ANIMATIONS['animate-' + key] = camelize('animate-' + key);
  ANIMATIONS['will-animate-' + key] = camelize('will-animate-' + key);
  ANIMATIONS['did-animate-' + key] = camelize('did-animate-' + key);
});


// ## animate
// Allow an element to use CSS3 transitions or animations to animate in or out of the page.
function animate(direction, node, callback) {
  var className = node.getAttribute('animate');
  var name = 'animate-' + direction;
  var methodName = ANIMATIONS[name];

  if (!className && !node[methodName]) {
    if (callback) callback.call(this);
    return;
  }

  var event = new CustomEvent(name, { cancelable: true });
  node.dispatchEvent(event);

  if (node.defaultPrevented) {
    if (callback) callback.call(this);
    return;
  }

  var willName = 'will-animate-' + direction;
  var didName = 'did-animate-' + direction;
  if (node[methodName]) {
    var willMethodName = ANIMATIONS[willName];
    var didMethodName = ANIMATIONS[didName];

    if (node[willMethodName]) {
      node[willMethodName]();
    }

    node[methodName](function() {
      if (callback) callback.call(this);

      if (node[didMethodName]) {
        node[didMethodName]();
      }
    });
  } else {
    if (!node.classList.has(className)) {
      node.classList.add(className);
    }

    node.classList.add(willName);
    var duration = getDuration(node, className + ' ' + willName);
    if (!duration) {
      node.classList.remove(willName);
      if (callback) callback.call(this);
      return;
    }

    if (name.indexOf('-in') > 0) {
      // reset the initial state so it doesn't try to animate in (e.g. starts with opacity=0 instead of fades there)
      var nextSibling = node.nextSibling;
      parentNode.removeChild(node);
      parentNode.insertBefore(node, nextSibling);
    } else {
      node.classList.add(willName);
    }

    requestAnimationFrame(function() {
      node.classList.remove(willName);
      node.classList.add(name);
      afterAnimation(node, duration, function() {
        node.classList.remove(name);
        if (callback) callback.call(this);
      });
    });
  }
}

var transitionDurationName = 'transitionDuration';
var transitionDelayName = 'transitionDelay';
var style = document.documentElement.style;
if (style.transitionDuration === undefined && style.webkitTransitionDuration !== undefined) {
  transitionDurationName = 'webkitTransitionDuration';
  transitionDelayName = 'webkitTransitionDelay';
}

var cache = {};
function getDuration(node, classes) {
  var milliseconds = cache[classes];
  if (milliseconds == null) {
    var styles = window.getComputedStyle(node);
    var seconds = parseFloat(styles[transitionDurationName]) + parseFloat(styles[transitionDelayName]);
    milliseconds = seconds * 1000 || 0;
    cache[classes] = milliseconds;
  }
  return milliseconds;
}


function afterAnimation(node, duration, callback) {
  var timeout;
  function done() {
    clearTimeout(timeout);
    callback();
  }

  // transitionend events don't always fire (e.g. when the browser doesn't have focus)
  timeout = setTimeout(done, duration);
}

function camelize(str) {
  return str.replace(/-(\w)/g, function(_, letter) { return letter.toUpperCase(); });
}
