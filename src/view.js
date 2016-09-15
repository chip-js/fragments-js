module.exports = View;
var Class = require('chip-utils/class');


/**
 * ## View
 * A DocumentFragment with bindings.
 */
function View(template) {
  this.context = null;
  if (!template) template = this;
  this.template = template;
  this.bindings = this.template.bindings.map(function(binding) {
    return binding.cloneForView(this);
  }, this);

  this.firstViewNode = this.firstChild;
  this.lastViewNode = this.lastChild;
  if (this.firstViewNode) {
    this.firstViewNode.view = this;
    this.lastViewNode.view = this;
  }
}


Class.extend(View, {

  get inDOM() {
    var parent = this.firstViewNode;
    var doc = parent.ownerDocument;
    while (parent && parent !== doc) {
      parent = parent.parentNode || parent.host;
    }
    return parent === doc;
  },

  /**
   * Removes a view from the DOM. A view is a DocumentFragment, so `remove()` returns all its nodes to itself.
   */
  remove: function() {
    var node = this.firstViewNode;
    var next;

    if (node.parentNode !== this) {
      // Remove all the nodes and put them back into this fragment
      while (node) {
        next = (node === this.lastViewNode) ? null : node.nextSibling;
        this.appendChild(node);
        node = next;
      }
    }

    this.detached();
  },


  /**
   * Removes a view (if not already removed) and adds the view to its template's pool.
   */
  dispose: function() {
    // Make sure the view is removed from the DOM
    this.bindings.forEach(function(binding) {
      binding.dispose();
    });
    this.context = null;

    this.remove();
    if (this.template) {
      this.template.returnView(this);
    }
  },


  /**
   * Binds a view to a given context.
   */
  bind: function(context) {
    this.context = context;
    this.bindings.forEach(function(binding) {
      binding.bind(context);
    });
  },


  /**
   * Unbinds a view from any context.
   */
  unbind: function() {
    this.bindings.forEach(function(binding) {
      binding.unbind();
    });
    this.context = null;
  },


  /**
   * Triggers the attached callback on the binders, call immediately after adding to the DOM
   */
  attached: function() {
    if (!this._attached && this.inDOM) {
      this._attached = true;
      this.bindings.forEach(function(binding) {
        binding.attach();
      });
    }
  },


  /**
   * Triggers the detached callback on the binders, call immediately after removing from the DOM
   */
  detached: function() {
    if (this._attached && !this.inDOM) {
      this._attached = false;
      this.bindings.forEach(function(binding) {
        binding.detach();
      });
    }
  },


  /**
   * Synchronizes this view against its context
   */
  sync: function() {
    if (this.context === null) return;
    this.bindings.forEach(function(binding) {
      binding.sync();
    });
  }
});
