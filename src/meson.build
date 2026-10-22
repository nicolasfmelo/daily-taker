app_conf = configuration_data()
app_conf.set('prefix', daily_taker_prefix)
app_conf.set('libdir', daily_taker_libdir)
app_conf.set('PACKAGE_VERSION', meson.project_version())
app_conf.set('GJS', gjs_console)
app_conf.set('APPLICATION_ID', application_id)

app = configure_file(
  input: 'dev.nicolas.DailyTaker.in',
  output: application_id,
  install: true,
  install_dir: daily_taker_pkgdatadir,
  configuration: app_conf
)

source_res_conf = configuration_data()
source_res_conf.set('profile', profile)
src_res = gnome.compile_resources(
  application_id + '.src',
  configure_file(
  	input: 'dev.nicolas.DailyTaker.src.gresource.xml.in',
  	output: '@BASENAME@',
  	configuration: source_res_conf
  ),
  source_dir: '.',
  gresource_bundle: true,
  install: true,
  install_dir: daily_taker_pkgdatadir
)

run_target('run',
  command: app,
  depends: [
    data_res,
    src_res,
  ]
)
