/* exported applyTheme */
// Tema fixo: o app é sempre escuro (cores em data/style.css), independente do sistema.
const { Adw, Gtk } = imports.gi;

// Chamar no startup, antes de Adw.Application.vfunc_startup (e de criar janelas).
var applyTheme = () => {
    Gtk.init();
    // Um gtk-application-prefer-dark-theme=true no settings.ini do usuário faz a
    // libadwaita avisar ao iniciar; o esquema de cores daqui é o que vale, então zera
    // o ajuste antes de ela ler.
    Gtk.Settings.get_default().gtk_application_prefer_dark_theme = false;
    Adw.init();
    Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.FORCE_DARK;
};
