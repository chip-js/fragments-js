var create = require('../').create;

describe('Template', function() {
  var fragments;

  beforeEach(function() {
    fragments = create();
  });

  it('should be able to create a view', function() {
    var template = fragments.createTemplate('<div><ul><li></li></ul></div>');
    var view = template.createView();
    expect(view.template).to.equal(template);
    expect(view.firstChild.innerHTML).to.equal('<ul><li></li></ul>');
  });

  it('should be able to reuse views', function() {
    var template = fragments.createTemplate('<div><ul><li></li></ul></div>');
    var view1 = template.createView();
    template.returnView(view1);
    var view2 = template.createView();
    expect(view1).to.equal(view2);
  });


});
