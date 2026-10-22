icon_dir = 'icons' / 'hicolor' / 'scalable' / 'apps'
install_data(
  'icons' / '@0@.svg'.format(application_id),
  install_dir:  daily_taker_datadir / icon_dir
)

icon_dir = 'icons' / 'hicolor' / 'symbolic' / 'apps'
install_data(
  'icons' / 'dev.nicolas.DailyTaker-symbolic.svg',
  rename: '@0@-symbolic.svg'.format(application_id),
  install_dir: daily_taker_datadir / icon_dir
)

desktop_conf = configuration_data()
desktop_conf.set('app-id', application_id)
desktop_file = configure_file(
  input: 'dev.nicolas.DailyTaker.desktop.in.in',
  output: '@0@.desktop'.format(application_id),
  configuration: desktop_conf,
  install: true,
  install_dir: daily_taker_datadir / 'applications'
)
desktop_file_validate = find_program('desktop-file-validate', required: false)
if desktop_file_validate.found()
  test(
    'validate-desktop',
    desktop_file_validate,
    args: [
      desktop_file
    ]
  )
endif

gsettings_conf = configuration_data()
gsettings_conf.set('app-id', application_id)
gsettings_conf.set('gettext-package', gettext_package)
configure_file(
  input: 'dev.nicolas.DailyTaker.gschema.xml.in',
  output: '@0@.gschema.xml'.format(application_id),
  configuration: gsettings_conf,
  install: true,
  install_dir: daily_taker_schemadir
)

data_res = gnome.compile_resources(
  application_id + '.data',
  'dev.nicolas.DailyTaker.data.gresource.xml',
  gresource_bundle: true,
  install_dir: daily_taker_pkgdatadir,
  install: true
)

metainfo_conf = configuration_data()
metainfo_conf.set('app-id', application_id)
metainfo_conf.set('gettext-package', gettext_package)

metainfo_file = configure_file(
  input: 'dev.nicolas.DailyTaker.metainfo.xml.in.in',
  output: '@0@.metainfo.xml'.format(application_id),
  configuration: metainfo_conf,
  install: true,
  install_dir: daily_taker_datadir / 'metainfo'
)

appstream_util = find_program('appstream-util', required: false)
if appstream_util.found()
  test(
    'validate-metainfo', appstream_util,
    args: [
      'validate-relax', '--nonet', metainfo_file
    ]
  )
endif
