export const VERSION_MODULE_OPTIONS = Symbol('VERSION_MODULE_OPTIONS');

export interface VersionModuleOptions {
  appName?: string;
  defaultVersion?: string;
  packageJsonPath?: string;
}
