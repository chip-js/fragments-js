var toFragment = require('../../src/util/toFragment');

describe('util/toFragment', function() {

  it('should be able to be created from a string of HTML', function() {
    var template = toFragment('<div><ul><li></li></ul></div>');
    expect(template.firstChild.tagName).to.equal('DIV');
    expect(template.firstChild.innerHTML).to.equal('<ul><li></li></ul>');
  });

  it('should be able to be created from an element and take that element out of the DOM', function() {
    var div = document.createElement('div');
    div.innerHTML = '<ul><li></li></ul>';
    document.body.appendChild(div);
    var template = toFragment(div);
    expect(template.firstChild.tagName).to.equal('DIV');
    expect(template.firstChild.innerHTML).to.equal('<ul><li></li></ul>');
    expect(div.parentNode).to.equal(template);
  });

  it('should be able to be created from an html collection or node list', function() {
    var div = document.createElement('div');
    div.id = 'test-node-list';
    div.innerHTML = '<ul><li></li></ul>  <p>Hello World</p>  Test';
    var div2 = div.cloneNode(true);
    var div3 = div.cloneNode(true);
    document.body.appendChild(div);
    var template = toFragment(document.querySelectorAll('#test-node-list'));
    expect(template.firstChild.tagName).to.equal('DIV');
    expect(template.firstChild.innerHTML).to.equal('<ul><li></li></ul>  <p>Hello World</p>  Test');
    expect(div.parentNode).to.equal(template);

    template = toFragment(div2.childNodes);
    expect(template.childNodes).to.have.length(4);

    template = toFragment(div3.children);
    expect(template.childNodes).to.have.length(2);
  });

  it('should be able to be created from a template element', function() {
    var tmpl = document.createElement('template');
    tmpl.innerHTML = '<ul><li></li></ul>';
    document.body.appendChild(tmpl);
    var template = toFragment(tmpl);
    expect(template.firstChild.tagName).to.equal('UL');
    expect(template.firstChild.innerHTML).to.equal('<li></li>');
  });

  it('should be able to call a passed function to create the template', function() {
    var template = toFragment(function() {
      return '<div><ul><li></li></ul></div>'
    });
    expect(template.firstChild.tagName).to.equal('DIV');
    expect(template.firstChild.innerHTML).to.equal('<ul><li></li></ul>');
  });
});
