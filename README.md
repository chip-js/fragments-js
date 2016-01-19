# Fragments.js

Fragments.js is a fast templating and data-binding library for front-end JavaScript applications. It relies on the
simplicity and speed of document fragments to create templates, clone new views from them, and manage pools of views for
reuse increasing runtime speed.

When Fragments.js turns a string or existing HTML element into a template, it walks that template's DOM and initializes
bindings that keep the DOM in sync with a data source which can be bound and unbound to the template. These bindings are
defined with binders, or code that gets called when a binding is found in the template. A binder can match on attribute
name (the most common) and element name. For example, if you define an attribute binder for `autoselect` that binder's
code will run against any element with an attribute of `autoselect`, with which you might do something like
automatically select the text inside an input when it is focused.

Binders provide all sorts of possibilities to be bound more easily in the markup. In the simplest case they can be used
to set attributes or add listeners to elements in the DOM. But they can be made to do much more. They are like Angular's
directives, but much simpler to create and use. They are like jQuery's plugins, but attached directly to an element in
its markup. You can create custom binders for your application to:
 * display a tooltip
 * make an element draggable
 * make an element a drop spot
 * turn an element into a file-upload hotspot
 * make an element into a component such as a tab view or image gallery



