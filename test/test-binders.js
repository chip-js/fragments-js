var fragments = require('../index');

describe('binder', function() {

	it('should allow a new binder to be added', function() {
		expect(fragments.getBinder('attribute', 'foo')).to.be.undefined;
		fragments.registerBinder('attribute', 'foo', function() {});
		expect(fragments.getBinder('attribute', 'foo')).to.not.be.undefined;
	});


	it('should allow a binder to be removed', function() {
		fragments.unregisterBinder('attribute', 'foo');
		expect(fragments.getBinder('attribute', 'foo')).to.be.undefined;
	});


	it('should call a binder when an element is processed', function() {
		var theValue;

		fragments.registerBinder('attribute', 'attr-foo', function(value) {
			theValue = value;
		});

		var template = fragments.createTemplate('<div attr-foo="the attr value"></div>');
		var view = template.createView();
		view.bind({});
		expect(theValue).to.equal('the attr value');
	});

});
