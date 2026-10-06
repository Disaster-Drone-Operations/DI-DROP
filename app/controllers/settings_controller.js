import ApplicationController from '/app/controllers/application_controller.js'
import { RecordNotFound } from '/lib/record.js'
import Setting from '/app/models/setting.js'

export default class SettingsController extends ApplicationController {
  async index() {
    this.redirectTo(`/settings/${Setting.schema[0].key}`)
  }

  async show() {
    await this.renderSection(this.params.section)
  }

  async update() {
    const values = this.params.settings ?? {}
    const errors = await Setting.updateSection(this.params.section, values)
    if (!errors) return this.redirectTo(`/settings/${this.params.section}`, { notice: 'Einstellungen gespeichert.' })
    await this.renderSection(this.params.section, { values, errors })
  }

  async renderSection(key, { values, errors = {} } = {}) {
    const section = Setting.section(key)
    if (!section) throw new RecordNotFound(`Unbekannte Einstellungs-Rubrik: ${key}`)
    values ??= Object.fromEntries(section.fields.map((f) => [f.key, Setting.get(`${key}.${f.key}`)]))
    await this.render('settings/show', { sections: Setting.schema, section, values, errors }, { title: `Einstellungen – ${section.title}` })
  }
}
