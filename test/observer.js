
describe('Observer', function() {
	var obj
	var observer
	var called
	var Observer = fragments.expression.Observer
	var expression = 'name'

	function getter() {
		return obj.name
	}

	beforeEach(function() {
		Observer.observers = [] // reset all observers
		obj = { name: 'test', age: 100 }
		called = 0
		observer = new Observer(expression, function(value) {
			called++
		})
	})


	it('should call the callback initially', function() {
		observer.bind(obj)
		expect(called).to.equal(1)
	})


	it('should not call the callback initially when skip requested', function() {
		observer.bind(obj, true)
		expect(called).to.equal(0)
	})


	it('should not call the callback if the value hasn\'t changed', function() {
		observer.bind(obj)
		expect(called).to.equal(1)
		Observer.sync()
		expect(called).to.equal(1)
	})


	it('should call the callback if the value changed', function() {
		observer.bind(obj)
		expect(called).to.equal(1)

		obj.name = 'test2'
		Observer.sync()
		expect(called).to.equal(2)
	})


	it('should not call the callback if another value changed', function() {
		observer.bind(obj)
		expect(called).to.equal(1)

		obj.age = 50
		Observer.sync()
		expect(called).to.equal(1)
	})


	it('should not call the callback after it is unbound', function() {
		observer.bind(obj)
		expect(called).to.equal(1)

		observer.unbind()
		expect(called).to.equal(2)
		obj.name = 'test2'
		Observer.sync()
		expect(called).to.equal(2)
	})


	it('should not call the callback if requested to skip the next sync', function() {
		observer.bind(obj)
		expect(called).to.equal(1)

		observer.skipNextSync()
		obj.name = 'test2'

		Observer.sync()
		expect(called).to.equal(1)

		Observer.sync()
		expect(called).to.equal(1)

		obj.name = 'test3'
		Observer.sync()
		expect(called).to.equal(2)
	})


	it('should be able to get the value', function() {
		observer.bind(obj)
		expect(observer.get()).to.equal(obj.name)
	})


	it('should be able to set the value', function() {
		observer.bind(obj)
		observer.set('test2')
		expect(obj.name).to.equal('test2')
		expect(called).to.equal(1)
		Observer.sync()
		expect(called).to.equal(2)
	})

})