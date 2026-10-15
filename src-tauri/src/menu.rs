//! German app menu for macOS. App-specific items (Settings, New assignment …)
//! send their id as a "menu" event to the UI – there menu and keyboard shortcuts
//! run through the same code (app/javascript/shortcuts.js).
//! On Windows there is no menu (unusual there); the UI catches the shortcuts itself.

use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accelerator: &str| {
        MenuItemBuilder::with_id(id, text).accelerator(accelerator).build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "di-drop")
        // Own page instead of the system window: it also lists attributions and licenses
        .item(&MenuItemBuilder::with_id("about", "Über di-drop").build(app)?)
        .item(&MenuItemBuilder::with_id("check_updates", "Nach Updates suchen …").build(app)?)
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

    // Undo/Redo are custom items: in text fields they act on the text,
    // otherwise on the app's last action (lib/undo.js)
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
        .item(&item("module_flightlogs", "Flugprotokolle", "CmdOrCtrl+3")?)
        .item(&item("module_batteries", "Akkunutzung", "CmdOrCtrl+4")?)
        .separator()
        .item(&item("uploads", "Uploads", "CmdOrCtrl+Alt+U")?)
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

/// After start (the menu is attached to the app by then): register "Fenster" (Window) and "Hilfe" (Help) with macOS.
/// macOS then lists the windows and adds the usual search field for all menu commands to the Help menu.
#[cfg(target_os = "macos")]
pub fn register_special_menus<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::MenuItemKind;
    let Some(menu) = app.menu() else { return Ok(()) };
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            match submenu.text()?.as_str() {
                "Fenster" => submenu.set_as_windows_menu_for_nsapp()?,
                "Hilfe" => submenu.set_as_help_menu_for_nsapp()?,
                _ => {}
            }
        }
    }
    Ok(())
}
