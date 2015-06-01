
describe('Binder', function() {
	var Binder = fragments.Binder


	it('should allow a new binder to be added', function() {
		expect(Binder.get('foo')).to.be.undefined
		Binder.register('foo', function() {})
		expect(Binder.get('foo')).to.not.be.undefined
	})


	it('should allow a binder to be removed', function() {
		Binder.unregister('foo')
		expect(Binder.get('foo')).to.be.undefined
	})


	it('should call a binder when an element is processed', function() {
		var theValue

		Binder.register('attr-foo', function(value) {
			theValue = value
		})

		var template = fragments.Template.createTemplate('<div attr-foo="the attr value"></div>');
		var view = template.createView();
		view.bind({})
		expect(theValue).to.equal('the attr value')
	})

})