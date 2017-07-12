module.exports = ElementController;
var ObservableHash = require('observations-js').ObservableHash;


function ElementController(observations) {
  ObservableHash.call(this, observations);

  Object.defineProperties(this, {
    _listeners: { value: [] }
  });
  this._listeners.enabled = true;
}


ObservableHash.extend(ElementController, {
  get listenersEnabled() {
    return this._listeners.enabled;
  },

  set listenersEnabled(value) {
    if (this.enabled === value) return;
    this._listeners.enabled = value;

    // Bind/unbind the observers for this hash
    if (value) {
      this._listeners.forEach(function(item) {
        item.targetRef = addListener(this, item.target, item.eventName, item.listener, item.capture);
      }, this);
    } else {
      this._listeners.forEach(function(item) {
        removeListener(item.targetRef, item.eventName, item.listener, item.capture);
        delete item.targetRef;
      }, this);
    }
  },


  listen: function(target, eventName, listener, context, capture) {
    var element = this instanceof Node ? this : this.element;
    if (typeof eventName === 'function') {
      capture = context;
      context = listener;
      listener = eventName;
      eventName = target;
      target = element;
    }

    if (!target || typeof listener !== 'function') {
      throw new TypeError('`listen([target], eventName, listener)` must have a function listener');
    }

    listener = listener.bind(context || this);

    if (typeof target === 'string') {
      // Listen on the element and match bubbled events against properties or query strings (like jquery.live)
      var innerListener = listener;
      var selector = target;
      target = element;
      listener = function(event) {
        if (this[selector] instanceof Node && this[selector].contains(event.target)) {
          innerListener(event);
        } else if (event.target.closest(selector)) {
          innerListener(event);
        }
      }.bind(this);
    }

    var listenerData = {
      target: target,
      eventName: eventName,
      listener: listener,
      capture: capture,
      targetRef: null
    };

    this._listeners.push(listenerData);

    if (this.listenersEnabled) {
      // If not bound will add on attachment
      listenerData.targetRef = addListener(this, target, eventName, listener, capture);
    }
  }
});


function getTarget(component, target) {
  var element = component instanceof Node ? component : component.element;
  if (typeof target === 'string') {
    target = component[target] || element.querySelector(target);
  } else if (target === Document) {
    target = element.ownerDocument;
  } else if (target === Window) {
    target = element.ownerDocument.defaultView;
  }
  return target;
}

function addListener(component, target, eventName, listener, capture) {
  // If it's been moved to another document change targets to the relavent one
  if ((target = getTarget(component, target))) {
    target.addEventListener(eventName, listener, capture);
    return target;
  }
}

function removeListener(target, eventName, listener, capture) {
  if (target) {
    target.removeEventListener(eventName, listener, capture);
  }
}
