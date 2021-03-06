module.exports = AnimatedBinding;
var animation = require('./util/animation');
var Binding = require('./binding');
var _super = Binding.prototype;

/**
 * Bindings which extend AnimatedBinding have the ability to animate elements that are added to the DOM and removed from
 * the DOM. This allows menus to slide open and closed, elements to fade in or drop down, and repeated items to appear
 * to move (if you get creative enough).
 *
 * The following 5 methods are helper DOM methods that allow registered bindings to work with CSS transitions for
 * animating elements. If an element has the `animate` attribute or a matching JavaScript method, these helper methods
 * will set a class on the node to trigger the animation and/or call the JavaScript methods to handle it.
 *
 * An animation may be either a CSS transition, a CSS animation, or a set of JavaScript methods that will be called.
 *
 * If using CSS, classes are added and removed from the element. When an element is inserted it will receive the `will-
 * animate-in` class before being added to the DOM, then it will receive the `animate-in` class immediately after being
 * added to the DOM, then both clases will be removed after the animation is complete. When an element is being removed
 * from the DOM it will receive the `will-animate-out` and `animate-out` classes, then the classes will be removed once
 * the animation is complete.
 *
 * If using JavaScript, methods must be defined  to animate the element there are 3 supported methods which can b
 *
 * TODO cache by class-name (Angular)? Only support javascript-style (Ember)? Add a `will-animate-in` and
 * `did-animate-in` etc.?
 * IF has any classes, add the `will-animate-in|out` and get computed duration. If none, return. Cache.
 * RULE is use unique class to define an animation. Or attribute `animate="fade"` will add the class?
 * `.fade.will-animate-in`, `.fade.animate-in`, `.fade.will-animate-out`, `.fade.animate-out`
 *
 * Events will be triggered on the elements named the same as the class names (e.g. `animate-in`) which may be listened
 * to in order to cancel an animation or respond to it.
 *
 * If the node has methods `animateIn(done)`, `animateOut(done)`, `animateMoveIn(done)`, or `animateMoveOut(done)`
 * defined on them then the helpers will allow an animation in JavaScript to be run and wait for the `done` function to
 * be called to know when the animation is complete.
 *
 * Be sure to actually have an animation defined for elements with the `animate` class/attribute because the helpers use
 * the `transitionend` and `animationend` events to know when the animation is finished, and if there is no animation
 * these events will never be triggered and the operation will never complete.
 */
function AnimatedBinding(properties) {
  var element = properties.node;
  var animate = element.getAttribute(properties.fragments.animateAttribute);
  var fragments = properties.fragments;

  if (animate !== null) {
    if (element.nodeName === 'TEMPLATE' || element.nodeName === 'SCRIPT') {
      throw new Error('Cannot animate multiple nodes in a template or script. Remove the [animate] attribute.');
    }

    setTimeout(function() {
      // Allow multiple bindings to animate by not removing until they have all been created
      element.removeAttribute(properties.fragments.animateAttribute);
    });

    this.animate = true;

    if (fragments.isBound('attribute', animate)) {
      // javascript animation
      this.animateExpression = fragments.codifyExpression('attribute', animate);
    } else {
      if (animate[0] === '.') {
        // class animation
        this.animateClassName = animate.slice(1);
      } else if (animate) {
        // registered animation
        var animateObject = fragments.getAnimation(animate);
        if (typeof animateObject === 'function') animateObject = new animateObject(this);
        this.animateObject = animateObject;
      }
    }
  }

  Binding.call(this, properties);
}


Binding.extend(AnimatedBinding, {
  init: function() {
    _super.init.call(this);
  },

  /**
   * Helper method to remove a node from the DOM, allowing for animations to occur. `callback` will be called when
   * finished.
   */
  animateOut: function(node, callback) {
    if (node.firstViewNode) node = node.firstViewNode;

    this.animateNode('out', node, callback);
  },

  /**
   * Helper method to insert a node in the DOM before another node, allowing for animations to occur. `callback` will
   * be called when finished. If `before` is not provided then the animation will be run without inserting the node.
   */
  animateIn: function(node, callback) {
    if (node.firstViewNode) node = node.firstViewNode;
    this.animateNode('in', node, callback, this);
  },

  /**
   * Allow an element to use CSS3 transitions or animations to animate in or out of the page.
   */
  animateNode: function(direction, node, callback) {
    var animateObject, className, classAnimateName, classWillName, whenDone, duration,
      methodAnimateName, methodWillName, methodDidName, dir, _this = this;

    if (this.fragments.disableAnimations) {
      return callback.call(_this);
    }

    if (this.animateExpression) {
      animateObject = this.get(this.animateExpression);
    } else {
      animateObject = this.animateObject;
    }

    if (animateObject && typeof animateObject === 'object') {
      animateObject.fragments = this.fragments;
    } else if (this.animateClassName) {
      className = this.animateClassName;
    } else if (this.animateObject === false) {
      return callback.call(_this);
    } else if (typeof this.animateObject === 'string') {
      if (this.animateObject[0] === '.') {
        className = this.animateObject.slice(1);
      } else if (this.animateObject) {
        animateObject = this.fragments.getAnimation(this.animateObject);
        if (typeof animateObject === 'function') animateObject = new animateObject(this);
      }
    }

    classAnimateName = 'animate-' + direction;
    classWillName = 'will-animate-' + direction;
    dir = direction === 'in' ? 'In' : 'Out';
    methodAnimateName = 'animate' + dir;
    methodWillName = 'willAnimate' + dir;
    methodDidName = 'didAnimate' + dir;
    whenDone = function() {
      if (animateObject && animateObject[methodDidName]) animateObject[methodDidName](node);
      node.classList.remove(classAnimateName);
      if (className) node.classList.remove(className);
      if (callback) callback.call(_this);
      node.dispatchEvent(new Event('animateend' + direction));
    };

    if (className) node.classList.add(className);

    node.dispatchEvent(new Event('animatestart' + direction));

    if (animateObject) {
      animation.makeElementAnimatable(node);
      if (typeof animateObject[methodWillName] === 'function') {
        node.classList.add(classWillName);
        animateObject[methodWillName](node);
        node.offsetWidth = node.offsetWidth;
        node.classList.remove(classWillName);
      }
      if (typeof animateObject[methodAnimateName] === 'function') {
        node.classList.add(classAnimateName);
        duration = getDuration.call(_this, node, direction);
        if (duration) {
          onAnimationEnd(node, duration, whenDone);
        } else {
          requestAnimationFrame(whenDone);
        }
        animateObject[methodAnimateName](node, whenDone);
      }
    } else {
      node.classList.add(classWillName);
      node.offsetWidth = node.offsetWidth;
      node.classList.remove(classWillName);
      node.classList.add(classAnimateName);
      duration = getDuration.call(_this, node, direction);
      if (duration) {
        onAnimationEnd(node, duration, whenDone);
      } else {
        requestAnimationFrame(whenDone);
      }
    }
  }
});


var transitionDurationName = 'transitionDuration';
var transitionDelayName = 'transitionDelay';
var animationDurationName = 'animationDuration';
var animationDelayName = 'animationDelay';
var transitionEventName = 'transitionend';
var animationEventName = 'animationend';
var style = document.documentElement.style;

['webkit', 'moz', 'ms', 'o'].forEach(function(prefix) {
  if (style.transitionDuration === undefined && style[prefix + 'TransitionDuration']) {
    transitionDurationName = prefix + 'TransitionDuration';
    transitionDelayName = prefix + 'TransitionDelay';
    transitionEventName = prefix + 'transitionend';
  }

  if (style.animationDuration === undefined && style[prefix + 'AnimationDuration']) {
    animationDurationName = prefix + 'AnimationDuration';
    animationDelayName = prefix + 'AnimationDelay';
    animationEventName = prefix + 'animationend';
  }
});


function getDuration(node, direction) {
  var milliseconds = this.clonedFrom['__animationDuration' + direction];
  if (!milliseconds) {
    // Recalc if node was out of DOM before and had 0 duration, assume there is always SOME duration.
    var styles = window.getComputedStyle(node);
    var tDuration = 0;
    var aDuration = 0;

    var tDurations = styles[transitionDurationName];
    if (tDurations) {
      var tDelays = styles[transitionDelayName].split(',');
      tDuration = Math.max.apply(Math, tDurations.split(',').map(function(dur, i) {
        return (parseFloat(dur) || 0) + (parseFloat(tDelays[i]) || 0);
      }));
    }
    var aDurations = styles[animationDurationName];
    if (aDurations) {
      var aDelays = styles[animationDelayName].split(',');
      aDuration = Math.max.apply(Math, aDurations.split(',').map(function(dur, i) {
        return (parseFloat(dur) || 0) + (parseFloat(aDelays[i]) || 0);
      }));
    }

    var seconds = Math.max(tDuration, aDuration);
    milliseconds = seconds * 1000 || 0;
    this.clonedFrom['__animationDuration' + direction] = milliseconds;
  }
  return milliseconds;
}


function onAnimationEnd(node, duration, callback) {
  var onEnd = function(event) {
    if (event && event.target !== node) return;
    node.removeEventListener(transitionEventName, onEnd);
    node.removeEventListener(animationEventName, onEnd);
    clearTimeout(timeout);
    callback();
  };

  // contingency plan
  var timeout = setTimeout(onEnd, duration);

  node.addEventListener(transitionEventName, onEnd);
  node.addEventListener(animationEventName, onEnd);
}
