import ApplicationController from '/app/controllers/application_controller.js'
import { QualificationType } from '/app/models/qualification.js'

// Kinds of qualifications (Settings → Einheit, settings/_qualification_types.ejs)
export default class QualificationsController extends ApplicationController {
  async create() {
    const types = await QualificationType.ordered()
    const type = new QualificationType({ name: this.params.name, position: (types.at(-1)?.position ?? 0) + 1 })
    if (await type.save()) return this.redirectTo('/settings/unit', { notice: `Nachweis „${type.name}“ hinzugefügt.` })
    this.redirectTo('/settings/unit', { alert: `Nachweis ${type.errors.name?.join(', ') ?? 'ungültig'}.` })
  }

  async update() {
    const type = await QualificationType.find(this.params.id)
    if (await type.update({ name: this.params.name })) return this.redirectTo('/settings/unit', { notice: `Nachweis „${type.name}“ gespeichert.` })
    this.redirectTo('/settings/unit', { alert: `Nachweis ${type.errors.name?.join(', ') ?? 'ungültig'}.` })
  }

  async destroy() {
    const type = await QualificationType.find(this.params.id)
    await type.destroy()
    this.redirectTo('/settings/unit', { notice: `Nachweis „${type.name}“ entfernt.` })
  }
}
