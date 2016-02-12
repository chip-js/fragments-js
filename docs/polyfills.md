# Fragment's Polyfills

Because fragments.js relies on a few new browser features it has simple polyfills to ensure these features exist. This
means that if you are using fragments you will have cross-browser access to these features as well.

## Element.matches()

The [`Element.matches(selector)`](https://developer.mozilla.org/en-US/docs/Web/API/Element/matches) method returns true
or false if an element matches the provided selector. This is similar to the `jQuery.is()` method. This polyfill ensures
that any browser-prefixed versions of this method are assigned to `Element.prototype.matches` so it may be used cross-
browser under its intended API.

## Element.closest()

The [`Element.closest(selector)`](https://developer.mozilla.org/en-US/docs/Web/API/Element/closest) method returns the
element closest to this one that matches the selector.

## Element.animate()

The [`Element.animate(keyframes, keyframeOptions)`](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)
method allows the CSS animation engine to be used to dynamically animate an element in a programatic way. This is
important in animating elements with variable heights to open and close as you cannot animate from `height: auto` to
`height: 0` in pure CSS.

This polyfill is incomplete as the full spec is quite robust. Because of this, a more simplified version of `animate`
is added to only those elements being animated with Fragments if the browser doesn't support it natively. If you would
like to use the simplified version from fragments use `util/animation`'s `makeElementAnimatable` method.
