project(
  'daily-taker',
  version: '0.1.0',
  license: 'GPL2+',
  meson_version: '>= 0.50.0'
)

if get_option('profile') == 'development'
  profile = 'Devel'
  name_suffix = ' (Development)'
  vcs_tag = run_command('git', 'rev-parse', '--short', 'HEAD').stdout().strip()
  if vcs_tag == ''
    version_suffix = '-devel'
  else
    version_suffix = '-@0@'.format (vcs_tag)
  endif
else
  profile = ''
  name_suffix = ''
  version_suffix = ''
endif
application_id = 'dev.nicolas.DailyTaker@0@'.format(profile)


daily_taker_prefix = get_option('prefix')
daily_taker_bindir = daily_taker_prefix / get_option('bindir')
daily_taker_libdir = daily_taker_prefix / get_option('libdir')
daily_taker_datadir = daily_taker_prefix / get_option('datadir')
daily_taker_pkgdatadir = daily_taker_datadir / application_id

daily_taker_schemadir = daily_taker_datadir / 'glib-2.0' / 'schemas'

gjs_dep = dependency('gjs-1.0', version: '>= 1.54.0')
gjs_console = gjs_dep.get_pkgconfig_variable('gjs_console')

# Lets check whether the dependencies exist
dependency('gio-2.0', version: '>= 2.43.4')
dependency('glib-2.0', version: '>= 2.39.3')
dependency('gtk4', version: '>= 4.4.0')
dependency('gstreamer-player-1.0', version: '>= 1.12')
dependency('libadwaita-1', version: '>= 1.0.0')
dependency('gobject-introspection-1.0', version: '>= 1.31.6')
dependency('gstreamer-1.0')
dependency('gstreamer-pbutils-1.0')
dependency('libsoup-3.0')
dependency('libsecret-1')

gnome = import('gnome')



subdir('data')
subdir('src')

meson.add_install_script(
  'build-aux' / 'meson_post_install.py',
  daily_taker_datadir,
  daily_taker_bindir,
  daily_taker_pkgdatadir,
  application_id
)
