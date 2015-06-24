
describe('binder', function() {


	it('should allow a new binder to be added', function() {
		expect(fragments.getBinder('attribute', 'foo')).to.be.undefined
		fragments.registerBinder('attribute', 'foo', function() {})
		expect(fragments.getBinder('attribute', 'foo')).to.not.be.undefined
	})


	it('should allow a binder to be removed', function() {
		fragments.unregisterBinder('attribute', 'foo')
		expect(fragments.getBinder('attribute', 'foo')).to.be.undefined
	})


	it('should call a binder when an element is processed', function() {
		var theValue

		fragments.registerBinder('attribute', 'attr-foo', function(value) {
			theValue = value
		})

		var template = fragments.createTemplate('<div attr-foo="the attr value"></div>')
		var view = template.createView()
		view.bind({})
		expect(theValue).to.equal('the attr value')
	})

})

describe('Default Binders', function() {

	describe('if and else', function() {

		it('should exist by default', function() {
			expect(fragments.getBinder('attribute', 'if')).to.not.be.undefined
		})

		it('should insert and remove a node', function() {
			var obj = { value: true }
			var template = fragments.createTemplate('<div><div if="{{value}}"></div></div>')
			var view = template.createView()
			view.bind(obj)

			expect(view.firstChild.children.length).to.equal(1)
			obj.value = false
			expect(view.firstChild.children.length).to.equal(1)
			fragments.sync()
			expect(view.firstChild.children.length).to.equal(0)
		})

		it('should show the correct element in a set', function() {
			var obj = { value: 'foo', foo: 'foo', bar: 'bar' }
			var template = fragments.createTemplate('<div><div if="{{value == foo}}">test1</div><div else-if="{{value == bar}}">test2</div><div else>test3</div></div>')
			var view = template.createView()
			view.bind(obj)

			expect(view.textContent).to.equal('test1')
			obj.value = 'bar'
			fragments.sync()
			expect(view.textContent).to.equal('test2')
			obj.value = 'anything else'
			fragments.sync()
			expect(view.textContent).to.equal('test3')
		})
	})


	describe('repeat', function() {

		it('should exist by default', function() {
			expect(fragments.getBinder('attribute', 'repeat')).to.not.be.undefined
		})

		it('should repeat elements', function() {
			var obj = { items: [
				{ name: 'test1' },
				{ name: 'test2' },
				{ name: 'test3' }
			]}

			var template = fragments.createTemplate('<div><div repeat="{{items}}">{{name}}</div></div>')
			var view = template.createView()
			view.bind(obj)

			expect(view.firstChild.children.length).to.equal(3)
			expect(view.textContent).to.equal('test1test2test3')
			obj.items.splice(1, 1)
			fragments.sync()
			expect(view.firstChild.children.length).to.equal(2)
			expect(view.textContent).to.equal('test1test3')
		})
	})
})