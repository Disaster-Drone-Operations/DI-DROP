//! Deutsches App-Menü für macOS. App-eigene Punkte (Einstellungen, Neuer Auftrag …)
//! schicken ihre Kennung als Ereignis "menu" an die Oberfläche – dort laufen Menü und
//! Tastenkürzel durch denselben Code (app/javascript/shortcuts.js).
//! Unter Windows gibt es kein Menü (unüblich); dort fängt die Oberfläche die Kürzel selbst ab.

use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accelerator: &str| {
        MenuItemBuilder::with_id(id, text).accelerator(accelerator).build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "di-drop")
        .about_with_text("Über di-drop", Some(AboutMetadata { name: Some("di-drop".into()), ..Default::default() }))
        .separator()
        .item(&item("settings", "Einstellungen …", "CmdOrCtrl+,")?)
        .separator()
        .services_with_text("Dienste")
        .separator()
        .hide_with_text("di-drop ausblenden")
        .hide_others_with_text("Andere ausblenden")
        .show_all_with_text("Alle einblenden")
        .separator()
        .quit_with_text("di-drop beenden")
        .build()?;

    let file = SubmenuBuilder::new(app, "Ablage")
        .item(&item("new_assignment", "Neuer Auftrag …", "CmdOrCtrl+N")?)
        .item(&item("new_mission", "Neuer Einsatz", "CmdOrCtrl+Shift+N")?)
        .separator()
        .item(&item("import", "Bilder importieren …", "CmdOrCtrl+O")?)
        .separator()
        .item(&item("save", "Sichern", "CmdOrCtrl+S")?)
        .close_window_with_text("Fenster schließen")
        .build()?;

    // Widerrufen/Wiederholen sind eigene Punkte: In Textfeldern wirken sie auf den Text,
    // sonst auf die letzte Aktion der App (lib/undo.js)
    let edit = SubmenuBuilder::new(app, "Bearbeiten")
        .item(&item("undo", "Widerrufen", "CmdOrCtrl+Z")?)
        .item(&item("redo", "Wiederholen", "CmdOrCtrl+Shift+Z")?)
        .separator()
        .cut_with_text("Ausschneiden")
        .copy_with_text("Kopieren")
        .paste_with_text("Einsetzen")
        .select_all_with_text("Alles auswählen")
        .build()?;

    let view = SubmenuBuilder::new(app, "Darstellung")
        .item(&item("module_missions", "Einsätze", "CmdOrCtrl+1")?)
        .item(&item("module_media", "Bilddaten", "CmdOrCtrl+2")?)
        .separator()
        .item(&item("back", "Zurück", "CmdOrCtrl+[")?)
        .item(&item("forward", "Vorwärts", "CmdOrCtrl+]")?)
        .separator()
        .fullscreen_with_text("Vollbild")
        .build()?;

    let window = SubmenuBuilder::new(app, "Fenster")
        .minimize_with_text("Im Dock ablegen")
        .maximize_with_text("Zoomen")
        .separator()
        .bring_all_to_front_with_text("Alle nach vorne bringen")
        .build()?;

    let help = SubmenuBuilder::new(app, "Hilfe")
        .item(&item("shortcuts", "Tastaturkürzel", "CmdOrCtrl+Shift+/")?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}
