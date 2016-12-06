module.exports = Template;
var View = require('./view');
var Class = require('chip-utils/class');


/**
 * ## Template
 * Takes an HTML string, an element, an array of elements, or a document fragment, and compiles it into a template.
 * Instances may then be created and bound to a given context.
 * @param {String|NodeList|HTMLCollection|HTMLTemplateElement|HTMLScriptElement|Node} html A Template can be created
 * from many different types of objects. Any of these will be converted into a document fragment for the template to
 * clone. Nodes and elements passed in will be removed from the DOM.
 */
function Template() {
  this.compiled = false;
  this.pool = [];
}


Class.extend(Template, {

  /**
   * Creates a new view cloned from this template.
   */
  createView: function(doc) {
    if (!doc) {
      doc = document;
    }
    if (doc === document && this.pool.length) {
      return this.pool.pop();
    }

    return View.makeInstanceOf(doc.importNode(this, true), this);
  },

  returnView: function(view) {
    if (view.ownerDocument === document && this.pool.indexOf(view) === -1) {
      this.pool.push(view);
    }
  }
});
