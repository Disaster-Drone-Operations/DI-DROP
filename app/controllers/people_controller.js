import ApplicationController from '/app/controllers/application_controller.js'
import Person from '/app/models/person.js'

// Module "Einheit": the people of the drone unit (their roles follow per mission, flight and assignment)
export default class PeopleController extends ApplicationController {
  async index() {
    await this.renderIndex()
  }

  async create() {
    const person = new Person(this.params.person)
    if (await person.save()) return this.redirectTo('/unit', { notice: `„${person.name}“ angelegt.` })
    await this.renderIndex({ editing: person })
  }

  async update() {
    const person = await Person.find(this.params.id)
    if (await person.update(this.params.person)) {
      return this.redirectTo('/unit', { notice: person.active ? `„${person.name}“ gespeichert.` : `„${person.name}“ ist jetzt inaktiv.` })
    }
    await this.renderIndex({ editing: person })
  }

  // editing: person whose dialog comes back with errors
  async renderIndex({ editing = null } = {}) {
    await this.render('people/index', { people: await Person.roster(), editing }, { title: 'Einheit' })
  }
}
