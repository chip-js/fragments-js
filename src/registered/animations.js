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


  var animatingOut = new Map();

  /**
   * Move items up and down in a list, slide down and up
   */
  fragments.registerAnimation('slide-move', {
    options: {
      duration: 300,
      easing: 'ease-in-out'
    },

    animateIn: function(element, done) {
      var oldElement, moveElement;
      var item = element.view && element.view._repeatItem_;
      if (item) {
        outElement = animatingOut.get(item);
        if (oldElement) {
          // This item is being removed in one place and added into another. Make it look like its moving by making both
          // elements not visible and having a clone move above the items to the new location.
          this.animateMove(oldElement, element);
        }
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
        animatingOut.set(item, element);
        setTimeout(function() {
          animatingOut.delete(item);
        });
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
      var moveElement;
      var parent = element.parentNode;
      if (!parent.__slideMoveHandled) {
        parent.__slideMoveHandled = true;
        if (window.getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }
      }

      oldElement.style.visibility = 'hidden';
      element.style.visibility = 'hidden';
      moveElement = fragments.makeElementAnimatable(oldElement.cloneNode(true));
      moveElement.style.position = 'absolute';
      parent.appendChild(moveElement);

      moveElement.animate([
        { top: oldElement.offsetTop + 'px' },
        { top: element.offsetTop + 'px' }
      ], this.options).onfinish = function() {
        newElement.style.visibility = '';
      };
    }
  });

}
