var animation = require('../../src/util/animation');

describe('util/animation', function() {

  it('should make sure an element has an .animate method', function() {
    var element = document.createElement('div');
    // Test this works when the API is not defined on a browser
    element.animate = undefined;
    expect(element.animate).to.be.undefined;
    animation.makeElementAnimatable(element);
    expect(element.animate).to.be.a('function');
    expect(element.getComputedCSS).to.be.a('function');
  });


  it('should get an element\'s computed css', function() {
    var element = document.createElement('div');
    element.id = 'foo-bar';
    var style = document.createElement('style');
    style.innerHTML = '#foo-bar { width: 100px }';
    document.querySelector('head').appendChild(style);
    document.body.appendChild(element);
    animation.makeElementAnimatable(element);
    expect(element.getComputedCSS('width')).to.equal('100px');
  });

});