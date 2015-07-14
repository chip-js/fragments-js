module.exports = registerDefaults;

/**
 * # Default Binders
 * Registers default binders with a fragments object.
 */
function registerDefaults(fragments) {

  /**
   * Fade in and out
   */
  fragments.registerAnimation('fade', {
    options: {
      duration: 300,
      easing: 'ease-in-out'
    },
    animateIn: function(element, done) {
      element.animate([
        { opacity: '0' },
        { opacity: '1' }
      ], this.options).onfinish = done;
    },
    animateOut: function(element, done) {
      element.animate([
        { opacity: '1' },
        { opacity: '0' }
      ], this.options).onfinish = done;
    }
  });


  /**
   * Slide down and up
   */
  fragments.registerAnimation('slide', {
    options: {
      duration: 300,
      easing: 'ease-in-out'
    },
    animateIn: function(element, done) {
      element.style.overflow = 'hidden';
      element.animate([
        { height: '0px' },
        { height: element.getComputedCSS('height') }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    },
    animateOut: function(element, done) {
      element.style.overflow = 'hidden';
      element.animate([
        { height: element.getComputedCSS('height') },
        { height: '0px' }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    }
  });


  var animating = new Map();

  /**
   * Move items up and down in a list, slide down and up
   */
  fragments.registerAnimation('slide-move', {
    options: {
      duration: 300,
      easing: 'ease-in-out'
    },

    animateIn: function(element, done) {
      var item = element.view && element.view._repeatItem_;
      if (item) {
        animating.set(item, element);
        setTimeout(function() {
          animating.delete(item);
        });
      }

      // Do the slide
      element.style.overflow = 'hidden';
      element.animate([
        { height: '0px' },
        { height: element.getComputedCSS('height') }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    },

    animateOut: function(element, done) {
      var item = element.view && element.view._repeatItem_;
      if (item) {
        var newElement = animating.get(item);
        if (newElement) {
          // This item is being removed in one place and added into another. Make it look like its moving by making both
          // elements not visible and having a clone move above the items to the new location.
          element = this.animateMove(element, newElement);
        }
      }

      // Do the slide
      element.style.overflow = 'hidden';
      element.animate([
        { height: element.getComputedCSS('height') },
        { height: '0px' }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    },

    animateMove: function(oldElement, newElement) {
      var placeholderElement;
      var parent = newElement.parentNode;
      if (!parent.__slideMoveHandled) {
        parent.__slideMoveHandled = true;
        if (window.getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }
      }

      var style = window.getComputedStyle(oldElement);
      placeholderElement = fragments.makeElementAnimatable(document.createElement(oldElement.nodeName));
      placeholderElement.style.width = oldElement.style.width = style.width;
      placeholderElement.style.height = oldElement.style.height = style.height;
      placeholderElement.style.visibility = 'hidden';

      oldElement.style.position = 'absolute';
      oldElement.style.zIndex = 1000;
      parent.insertBefore(placeholderElement, oldElement);
      newElement.style.visibility = 'hidden';

      oldElement.animate([
        { top: placeholderElement.offsetTop + 'px' },
        { top: newElement.offsetTop + 'px' }
      ], this.options).onfinish = function() {
        placeholderElement.remove();
        newElement.style.visibility = '';
      };

      return placeholderElement;
    }
  });

}
