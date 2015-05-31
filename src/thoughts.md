[if]/[unless]
element removed and placed conditionally
* doesn't need to be recreated, just needs to be able to be bound/unbound at will
* often found within a repeat, could fragments/elements within a repeat be reused without complicating? For large chunks
  of DOM this might be beneficial. Perhaps Template can cache fragments by their HTML strings for reuse throughout an
  application. This would also prevent re-preprocessing.


[each]
element removed and repeated


[partial]
elements removed (and placed inside [content])
template by name placed here


[content]
if content was used in partial, put it into [content] otherwise leave [content]'s contents


[controller]/[model]?


[X] Template
[-] Animations/Transitions
[X] Binding
[ ] Bindings
[ ] Filter (Formatter)
[ ] Filters (Formatters)
[X] Allow observers to bind/unbind/rebind to objects, their getters should run within a settable context.
[X] bind-if includes else-if and else
[ ] bind-each keeps node-value pairs together during sorts etc.
[ ] bind-each creates prototype children (not new controllers)
[X] observers have a get() and set(value) instead of controller's eval(expr) and evalSetter(expr, value), need other way too that doesn't constantly "watch" the value
[X] bindings can add expressions to be observed during compile

