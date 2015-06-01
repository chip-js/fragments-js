module.exports = Observer;
var expression = require('./expression');
var formatters = require('./formatter').formatters;
var diff = require('./diff');

// # Observer

// Defines an observer class which represents an expression. Whenever that expression returns a new value the `callback`
// is called with the value.
//
// If the old and new values were either an array or an object, the `callback` also
// receives an array of splices (for an array), or an array of change objects (for an object) which are the same
// format that `Array.observe` and `Object.observe` return <http://wiki.ecmascript.org/doku.php?id=harmony:observe>.
function Observer(expr, callback) {
  this.getter = expression.get(expr);
  if (!/['"']$/.test(expr)) {
    this.setter = expression.getSetter(expr);
  }
  this.callback = callback;
  this.skip = false;
  this.context = null;
  this.oldValue = undefined;
}

Observer.prototype = {

  // Binds this expression to a given context
  bind: function(context, skipUpdate) {
    this.context = context;
    Observer.add(this, skipUpdate);
  },

  // Unbinds this expression
  unbind: function() {
    this.context = null;
    Observer.remove(this);
    this.sync();
  },

  // Returns the current value of this observer
  get: function() {
    if (this.context) {
      return this.getter.call(this.context, formatters);
    }
  },

  // Sets the value of this expression
  set: function(value) {
    if (this.context && this.setter) {
      return this.setter.call(this.context, formatters, value);
    }
  },


  // Instructs this observer to not call its `callback` on the next sync, whether the value has changed or not
  skipNextSync: function() {
    this.skip = true;
  },


  // Syncs this observer now, calling the callback immediately if there have been changes
  sync: function() {
    var value = this.get();

    // Don't call the callback if `skipNextSync` was called on the observer
    if (this.skip || !this.callback) {
      this.skip = false;
    } else {
      // If an array has changed calculate the splices and call the callback. This
      var changed = diff.values(value, this.oldValue);
      if (!changed) return;
      if (Array.isArray(changed)) {
        this.callback(value, this.oldValue, changed)
      } else {
        this.callback(value, this.oldValue);
      }
    }

    // Store an immutable version of the value, allowing for arrays and objects to change instance but not content and
    // still refrain from dispatching callbacks (e.g. when using an object in bind-class or when using array formatters
    // in bind-each)
    this.oldValue = diff.clone(value);
  }
};


// An array of all observers, considered *private*
Observer.observers = [];

// An array of callbacks to run after the next sync, considered *private*
Observer.callbacks = [];
Observer.listeners = [];

// Adds a new observer to be synced with changes. If `skipUpdate` is true then the callback will only be called when a
// change is made, not initially.
Observer.add = function(observer, skipUpdate) {
  this.observers.push(observer);
  if (!skipUpdate) observer.sync();
};

// Removes an observer, stopping it from being run
Observer.remove = function(observer) {
  var index = this.observers.indexOf(observer);
  if (index !== -1) {
    this.observers.splice(index, 1);
    return true;
  } else {
    return false;
  }
};

// *private* properties used in the sync cycle
Observer.syncing = false;
Observer.rerun = false;
Observer.cycles = 0;
Observer.max = 10;
Observer.timeout = null;

// Runs the observer sync cycle which checks all the observers to see if they've changed.
Observer.sync = function(callback) {
  if (typeof callback === 'function') {
    this.afterSync(callback);
  }

  if (this.syncing) {
    this.rerun = true;
    return false;
  }

  this.syncing = true;
  this.rerun = true;
  this.cycles = 0;

  // Allow callbacks to run the sync cycle again immediately, but stop at `this.max` (default 10) cycles to we don't
  // run infinite loops
  while (this.rerun) {
    if (++this.cycles === this.max) {
      throw new Error('Infinite observer syncing, an observer is calling Observer.sync() too many times');
    }
    this.rerun = false;
    // the observer array may increase or decrease in size (remaining observers) during the sync
    for (var i = 0; i < this.observers.length; i++) {
      this.observers[i].sync();
    }
  }

  while (this.callbacks.length) {
    this.callbacks.shift()();
  }

  for (var i = 0, l = this.listeners.length; i < l; i++) {
    var listener = this.listeners[i];
    listener();
  }

  this.syncing = false;
  this.cycles = 0;
  return true;
};

Observer.syncLater = function(callback) {
  if (!this.timeout) {
    var _this = this;
    this.timeout = setTimeout(function() {
      _this.timeout = null;
      _this.sync(callback);
    });
    return true;
  } else {
    return false;
  }
};

// After the next sync (or the current if in the middle of one), run the provided callback
Observer.afterSync = function(callback) {
  if (typeof callback === 'function') {
    throw new TypeError('callback must be a function');
  }
  this.callbacks.push(callback);
};

Observer.onSync = function(listener) {
  if (typeof listener === 'function') {
    throw new TypeError('listener must be a function');
  }
  this.listeners.push(listener);
};

Observer.removeOnSync = function(listener) {
  if (typeof listener === 'function') {
    throw new TypeError('listener must be a function');
  }
  var index = this.listeners.indexOf(listener);
  if (index !== -1) {
    this.listeners.splice(index, 1).pop();
  }
};
