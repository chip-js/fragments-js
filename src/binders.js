var Binder = require('./binder');
var Template = require('./template');

// # Default Bindings


Binder.registerBinder('bind-debug', {
  priority: 200,
  udpated: function(value) {
    console.info('Debug:', this.expression, '=', value);
  }
});



// ## bind-text
// Adds a handler to display text inside an element.
//
// **Example:**
// ```xml
// <h1 bind-text="post.title">Title</h1>
// <div class="info">
//   Written by
//   <span bind-text="post.author.name">author</span>
//   on
//   <span bind-text="post.date.toLocaleDateString()">date</span>.
// </div>
// ```
// *Result:*
// ```xml
// <h1>Little Red</h1>
// <div class="info">
//   Written by
//   <span>Jacob Wright</span>
//   on
//   <span>10/16/2013</span>.
// </div>
// ```
Binder.registerBinder('bind-text', function(value) {
  element.textContent = (value == null) ? '' else value;
});


// ## bind-html
// Adds a handler to display unescaped HTML inside an element. Be sure it's trusted!
//
// **Example:**
// ```xml
// <h1 bind-text="post.title">Title</h1>
// <div bind-html="post.body"></div>
// ```
// *Result:*
// ```xml
// <h1>Little Red</h1>
// <div>
//   <p>Little Red Riding Hood is a story about a little girl.</p>
//   <p>
//     More info can be found on
//     <a href="http://en.wikipedia.org/wiki/Little_Red_Riding_Hood">Wikipedia</a>
//   </p>
// </div>
// ```
Binder.registerBinder('bind-html', function(value) {
  element.innerHTML = value == null ? '' : value;
});



// ## bind-class
// Adds a handler to add classes to an element. If the value of the expression is a string, that string will be set as the
// class attribute. If the value is an array of strings, those will be set as the element classes. These two methods
// overwrite any existing classes. If the value is an object, each property of that object will be toggled on or off in
// the class list depending on whether the value of the property is truthy or falsey.
//
// **Example:**
// ```xml
// <div bind-class="theClasses">
//   <button class="btn primary" bind-class="{highlight:ready}"></button>
// </div>
// ```
// *Result if `theClases` equals "red blue" and `ready` is `true`:*
// ```xml
// <div class="red blue">
//   <button class="btn primary highlight"></button>
// </div>
// ```
Binder.registerBinder('bind-class', {
  compiled: function(options) {
    this.existingClasses = (options.element.getAttribute('class') || '').split(/\s+/);
    if (this.existingClasses[0] === '') this.existingClasses.pop();
  },
  updated: function(value) {
    if (Array.isArray(value)) {
      value = value.join(' ');
    }

    if (typeof value === 'string') {
      this.element.className = this.existingClasses.concat(value.split(/\s+/)).join(' ');
    } else if (value && typeof value === 'object') {
      var classList = this.element.classList;
      Object.keys(value).forEach(function(className) {
        if (value[className]) {
          classList.add(className);
        } else {
          classList.remove(className);
        }
      });
    }
  }
});


Binder.registerBinder('bind-attr', function(value, oldValue, changes) {
  if (changes) {
    // use the change records to remove deleted properties which won't show up
    changes.forEach(function(change) {
      if (change.type === 'deleted' || !value[change.name]) {
        this.element.removeAttribute(change.name);
      } else {
        this.element.setAttribute(change.name, value[change.name]);
      }
    });
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(function(attrName) {
      var attrValue = value[attrName];
      if (attrValue) {
        this.element.setAttribute(attrName, attrValue);
      } else {
        this.element.removeAttribute(attrName);
      }
    }, this);
  }
});


// ## bind-value
// Adds a handler which sets the value of an HTML form element. This handler also updates the data as it is changed in
// the form element, providing two way binding.
//
// **Example:**
// ```xml
// <label>First Name</label>
// <input type="text" name="firstName" bind-value="user.firstName">
//
// <label>Last Name</label>
// <input type="text" name="lastName" bind-value="user.lastName">
// ```
// *Result:*
// ```xml
// <label>First Name</label>
// <input type="text" name="firstName" value="Jacob">
//
// <label>Last Name</label>
// <input type="text" name="lastName" value="Wright">
// ```
// And when the user changes the text in the first input to "Jac", `user.firstName` will be updated immediately with the
// value of `'Jac'`.
Binder.registerBinder('bind-value', function(element, attr, controller) {
  expr = attr.value
  watchExpr = expr

  fieldExpr = element.attr('bind-value-field')
  element.removeAttr('bind-value-field')

  if element.is('select')
    selectValueField = if fieldExpr then controller.eval(fieldExpr) else null
    chip.lastSelectValueField = selectValueField

  if element.is('option') and (fieldExpr or chip.lastSelectValueField)
    if fieldExpr
      selectValueField = controller.eval(fieldExpr)
    else
      selectValueField = chip.lastSelectValueField
    watchExpr += '.' + selectValueField

  if element.attr('type') is 'checkbox'
    checkedAttr = element.attr('checked-value') or 'true'
    uncheckedAttr = element.attr('unchecked-value') or 'false'
    element.removeAttr('checked-value')
    element.removeAttr('unchecked-value')
    checkedValue = controller.eval(checkedAttr)
    uncheckedValue = controller.eval(uncheckedAttr)

  // Handles input (checkboxes, radios), select, textarea, option
  getValue =
    if element.attr('type') is 'checkbox' # Handles checkboxes
      -> element.prop('checked') and checkedValue or uncheckedValue
    else if element.attr('type') is 'file'
      -> element.get(0).files?[0]
    else if element.is(':not(input,select,textarea,option)') # Handles a group of radio inputs
      -> element.find('input:radio:checked').val()
    else if selectValueField and element.is('select')
      (realValue) ->
        if realValue
          $(element.get(0).options[element.get(0).selectedIndex]).data('value')
        else
          element.val()
    else # Handles other form inputs
      -> element.val()

  setValue =
    if element.attr('type') is 'checkbox'
      (value) -> element.prop('checked', value is checkedValue)
    else if element.attr('type') is 'file'
      (value) -> # "get" only
    else if element.is(':not(input,select,textarea,option)') // Handles a group of radio inputs
      (value) ->
        element.find('input:radio:checked').prop('checked', false) // in case the value isn't found in radios
        element.find('input:radio[value="' + value + '"]').prop('checked', true)
    else
      (value) ->
        strValue = selectValueField and value?[selectValueField] or value
        strValue = '' + strValue if strValue?
        element.val(strValue)
        element.data('value', value) if selectValueField

  observer = controller.watch watchExpr, (value) ->
    if getValue() isnt '' + value # Allows for string/number equality
      setValue controller.eval expr

  // Skips setting values on option elements since the user cannot change these with user input
  return if element.is 'option'

  // Sets initial element value. For SELECT elements allows child option element values to be set first.
  if element.is('select')
    element.one 'processed', ->
      setValue controller.eval expr
      unless element.is('[readonly]')
        controller.evalSetter expr, getValue(true)
  else unless element.is('[readonly]')
    controller.evalSetter expr, getValue()

  events = element.attr('bind-value-events') or 'change'
  element.removeAttr('bind-value-events')
  if element.is ':text'
    element.on 'keydown', (event) ->
      if event.keyCode is 13
        element.trigger 'change'

  element.on events, ->
    if getValue() isnt observer.oldValue and not element.is('[readonly]')
      controller.evalSetter expr, getValue(true)
      observer.skipNextSync() // don't update this observer, user changed it
      controller.sync() // update other expressions looking at this data



// ## on-[event]
// Adds a handler for each event name in the array. When the event is triggered the expression will be run.
//
// **Example Events:**
//
// * on-click
// * on-dblclick
// * on-submit
// * on-change
// * on-focus
// * on-blur
//
// **Example:**
// ```xml
// <form on-submit="saveUser()">
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
// *Result (events don't affect the HTML):*
// ```xml
// <form>
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
Binder.registerBinder('on-*', function(element, attr, controller) {
  eventName = attr.match
  expr = attr.value
  element.on eventName, (event) ->
    // prevent native events, let custom events use this mechanism
    if event.originalEvent
      event.preventDefault()
    unless element.attr('disabled')
      controller.eval expr, event: event, element: element



// ## native-[event]
// Adds a handler for each event name in the array. When the event is triggered the expression will be run.
// It will not call event.preventDefault() like on-* or withold when disabled.
//
// **Example Events:**
//
// * native-click
// * native-dblclick
// * native-submit
// * native-change
// * native-focus
// * native-blur
//
// **Example:**
// ```xml
// <form native-submit="saveUser(event)">
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
// *Result (events don't affect the HTML):*
// ```xml
// <form>
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
Binder.registerBinder('native-*', function(element, attr, controller) {
  eventName = attr.match
  expr = attr.value
  element.on eventName, (event) ->
    controller.eval expr, event: event, element: element


// ## on-[key event]
// Adds a handler which is triggered when the keydown event's `keyCode` property matches.
//
// **Key Events:**
//
// * on-enter
// * on-esc
//
// **Example:**
// ```xml
// <input on-enter="window.alert(element.val())">
// ```
// *Result:*
// ```xml
// <input>
// ```
keyCodes = { enter: 13, esc: 27 }
for own name, keyCode of keyCodes
  chip.keyEventBinding('on-' + name, keyCode)

// ## on-[control key event]
// Adds a handler which is triggered when the keydown event's `keyCode` property matches and the ctrlKey or metaKey is
// pressed.
//
// **Key Events:**
//
// * on-ctrl-enter
//
// **Example:**
// ```xml
// <input on-ctrl-enter="window.alert(element.val())">
// ```
// *Result:*
// ```xml
// <input>
// ```
chip.keyEventBinding('on-ctrl-enter', keyCodes.enter, true)

// ## attr-[attribute]
// Adds a handler to set the attribute of element to the value of the expression.
//
// **Example Attributes:**
//
// * attr-checked
// * attr-disabled
// * attr-multiple
// * attr-readonly
// * attr-selected
//
// **Example:**
// ```xml
// <img attr-src="user.avatarUrl">
// ```
// *Result:*
// ```xml
// <img src="http://cdn.example.com/avatars/jacwright-small.png">
// ```
Binder.registerBinder('attr-*', function(element, attr, controller) {
  if attr.name isnt attr.match # e.g. attr-href="someUrl"
    attrName = attr.match
    expr = attr.value
  else # e.g. href="http://example.com{{someUrl}}"
    attrName = attr.name
    expr = expression.revert attr.value

  controller.watch expr, (value) ->
    if value?
      element.attr attrName, value
      element.trigger attrName + 'Changed'
    else
      element.removeAttr attrName

// ## attr-[toggle attribute]
// Adds a handler to toggle an attribute on or off if the expression is truthy or falsey.
//
// **Attributes:**
//
// * attr-checked
// * attr-disabled
// * attr-multiple
// * attr-readonly
// * attr-selected
//
// **Example:**
// ```xml
// <label>Is Administrator</label>
// <input type="checkbox" attr-checked="user.isAdmin">
// <button attr-disabled="isProcessing">Submit</button>
// ```
// *Result if `isProcessing` is `true` and `user.isAdmin` is false:*
// ```xml
// <label>Is Administrator</label>
// <input type="checkbox">
// <button disabled>Submit</button>
// ```
[ 'attr-checked', 'attr-disabled', 'attr-multiple', 'attr-readonly', 'attr-selected' ].forEach (name) ->
  chip.attributeToggleBinding(name)




























// ## bind-if
// Adds a handler to show or hide the element if the value is truthy or falsey. Actually removes the element from the DOM
// when hidden, replacing it with a non-visible placeholder and not needlessly executing bindings inside.
//
// **Example:**
// ```xml
// <ul class="header-links">
//   <li bind-if="user"><a href="/account">My Account</a></li>
//   <li bind-if="user"><a href="/logout">Sign Out</a></li>
//   <li bind-if="!user"><a href="/login">Sign In</a></li>
// </ul>
// ```
// *Result if `user` is null:*
// ```xml
// <ul class="header-links">
//   <!--bind-if="user"-->
//   <!--bind-if="user"-->
//   <li><a href="/login">Sign In</a></li>
// </ul>
// ```
Binder.registerBinder('bind-if', {
  priority: 50,

  compiled: function(options) {
    var element = options.element;
    var expressions = [ options.expression ];
    var placeholder = document.createTextNode('');
    var node = element.nextElementSibling;
    options.element = placeholder;
    element.parentNode.replaceChild(placeholder, element);

    // Convert the element into a template so we can reuse it
    Template.createTemplate(element);

    // Stores a template for all the elements that can go into this spot
    options.template = [ element ];

    // Pull out any other elements that are chained with this one
    while (node) {
      var next = node.nextElementSibling;
      if (node.hasAttribute('bind-else-if')) {
        expressions.push(node.getAttribute('bind-else-if'));
        node.removeAttribute('bind-else-if');
      } else if (node.hasAttribute('bind-else')) {
        node.removeAttribute('bind-else');
        next = null;
      } else {
        break;
      }

      node.remove();
      Template.createTemplate(node);
      options.templates.push(node);
      node = next;
    }

    // An expression that will return an index. Something like this `expr ? 0 : expr2 ? 1 : expr3 ? 2 : 3`. This will be
    // used to know which section to show in the if/else-if/else grouping.
    options.expression = expressions.map(function(expr, index) {
      '(' + expr + ') ? ' + index + ' : ';
    }).join('') + expressions.length;
  },

  updated: function(index) {
    if (this.showing) {
      this.showing.dispose();
      this.showing = null;
    }
    var template = this.template[index];
    if (template) {
      this.showing = template.createView();
      this.showing.bind(this.context);
      this.element.parentNode.insertBefore(this.showing, this.element.nextSibling);
    }
  }
});



var binding = require('./binding');

binding.addBinding('[text]');

binding.addBinding('[html]');

// ... etc ...


binding.addBinding('(enter)', enterKeyEvent);
binding.addBinding('(esc)', escapeKeyEvent);


// Listen on the provided event (e.g. `(click)="doSomething()"`).
binding.addBinding('(*)', eventCatchAll);

// Set an attribute to the computed value (e.g. `[href]="member.websiteUrl"`).
binding.addBinding('[*]', attributeCatchAll);

// Toggle an attribte to exist or not (e.g. checked, selected, hidden, disabled, etc).
binding.addBinding('*?', attributeToggle);



