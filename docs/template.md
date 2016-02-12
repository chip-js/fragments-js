# Template

A template is an instance of [`DocumentFragment`](https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment), a
very lightweight DOM container for HTML nodes. This is where fragments.js gets its name from, the heavy use of these
lightweight containers. Fragments.js adds a couple of additional methods to these `DocumentFragment`s to turn them into
templates. Templates will pool views for reuse

## createView()

The `template.createView()` method returns a new [View](view.md). If there are views in the pool it will reuse one of
these.

## returnView()

The `template.returnView(view)` method returns a view to the template pool.

