const path = require("path");
const fs = require("fs");

/**
 * Rewrite of cuddlefish/packaging.py
 *
 * Read package.json and packages directories to build a generic package description.
 */

// List of all package directories with default names
// This list is used when package.json doesn't specify any specific name
const SECTION_DEFAULTS = {
  lib: ['lib'],
  tests: ['test', 'tests'],
  doc: ['doc', 'docs'],
  data: ['data'],
  packages: ['packages']
};

// Name of the module to load first
const DEFAULT_PROGRAM_MODULE = 'main';

function normalizeAndValidate(packagePath, json) {
  // If package.json doesn't have `name` attribute, 
  // we take folder name as package name.
  if (!json.name)
    json.name = path.basename(packagePath);
  
  // Normalize lists.
  // In package.json, each list can be defined as :
  //  - a list of elements (for now, only strings),
  //  - a single element that decribe a list of one element.
  // https://github.com/mozilla/addon-sdk/blob/master/python-lib/cuddlefish/packaging.py#L192
  function normalize(name) {
    if (typeof json[name]=="string")
      json[name] = [json[name]];
    else if (!json[name])
      json[name] = [];
  }
  for each(let name in ['lib', 'tests', 'doc', 'data', 'dependencies', 'packages'])
    normalize(name);
  
  // Validate section folders if something is specified
  // Or register default folder if such folder exists
  // https://github.com/mozilla/addon-sdk/blob/master/python-lib/cuddlefish/packaging.py#L121
  function add_section_dir(section, defaults) {
    let list = json[section];
    if (list.length > 0) {
      // One or more directories has been specified in package.json via
      // a root attribute. for ex: { lib: 'libs', ... } or 
      //                           { tests: ['commonjs', 'test'], ... }
      for each (let relativePath in list) {
        let sectionDir = path.join(packagePath, relativePath);
        if (!path.existsSync(sectionDir) || 
            !fs.statSync(sectionDir).isDirectory()) {
          throw new Error(
            "Error while registering `" + section + "` directory for package " +
            "`" + json.name + "`. '" + sectionDir + "' is not a valid directory");
        }
      }
      // No error was thrown, so folders mentioned are valid.
      return;
    }
    let directoryAttribute = "directories" in json && 
                             section in json.directories ? 
                             json.directories[section] : null;
    if (directoryAttribute) {
      // One directory has been specified in `directories` attribute
      // for ex: { directories: { lib: 'libs' }, ... }
      let sectionDir = path.join(packagePath, directoryAttribute);
      if (!path.existsSync(sectionDir) || 
          !fs.statSync(sectionDir).isDirectory()) {
        throw new Error(
          "Error while registering `" + section + "` directory for package " +
          "`" + json.name + "`. '" + sectionDir + "' is not a valid directory");
      }
      json[section] = [directoryAttribute];
      return;
    }
    
    // Check if a directory exists with one default name
    for each (let name in defaults) {
      let sectionDir = path.join(packagePath, name);
      if (path.existsSync(sectionDir) &&
          fs.statSync(sectionDir).isDirectory()) {
        json[section] = [name];
        return;
      }
    }
  }
  for (let section in SECTION_DEFAULTS)
    add_section_dir(section, SECTION_DEFAULTS[section]);
  
  // If no folder was specified, nor default folder exists,
  // we are using root package folder as `lib` folder.
  if (json.lib.length == 0) {
    json.lib = ["."];
  }
  
  if ("main" in json) {
    // Normalize to module name, not filename.
    json.main = json.main.replace(/\.js$/, "");
    // Validate existing `main` attribute
    let foundIt = false;
    for each (let folder in json.lib) {
      let mainFile = path.join(packagePath, folder, json.main + ".js");
      if (path.existsSync(mainFile) &&
          fs.statSync(mainFile).isFile()) {
        foundIt = true;
        break;
      }
    }
    if (!foundIt)
      throw new Error(
        "Error while registering main module for package `" + json.name + "`." +
        "Unable to find main module: '" + json.main + "'.");
  }
  else {
    // Automatically register main module if default's one exists
    for each (let folder in json.lib) {
      let mainFile = path.join(packagePath, folder, DEFAULT_PROGRAM_MODULE + ".js");
      if (path.existsSync(mainFile) &&
          fs.statSync(mainFile).isFile()) {
        json.main = DEFAULT_PROGRAM_MODULE;
        break;
      }
    }
  }
  
  json.root_dir = packagePath;
  
  return json;
}

exports.getPackage = function (packagePath) {
  var packageManifest = path.join(packagePath, "package.json");
  if (!path.existsSync(packageManifest)) return null;
  var json = JSON.parse(fs.readFileSync(packageManifest));
  return normalizeAndValidate(packagePath, json);
}

exports.getPackages = function (rootPath, existingPackages) {
  let packages = existingPackages || {};
  
  function parseDir(dir) {
    let dirs = fs.readdirSync(dir);
    for(let i=0; i<dirs.length; i++) {
      let packagePath = path.join(dir, dirs[i]);
      let manifestPath = path.join(packagePath, "package.json");
      if (!path.existsSync(manifestPath)) continue;
      parsePackage(packagePath, manifestPath);
    }
  }
  
  function parsePackage(packagePath, manifestPath) {
    let json = JSON.parse(fs.readFileSync(manifestPath));
    let manifest = normalizeAndValidate(packagePath, json);
    if (packages[manifest.name]) {
      if (packages[manifest.name].root_dir == packagePath)
        return;
      throw new Error("Duplicate package '" + manifest.name + "' : \n" +
                      " - " + manifest.root_dir + "\n" +
                      " - " + packages[manifest.name].root_dir);
    }
    packages[manifest.name] = manifest;
    if (manifest.packages) {
      for each (let packageDirName in manifest.packages) {
        let packageFile = path.join(manifest.root_dir,packageDirName);
        parseDir(packageFile);
      }
    }
  }
  
  // Only fetch "in directory" package if there is a package.json file
  // in root folder.
  let inDirManifest = path.join(rootPath, "package.json");
  if (path.existsSync(inDirManifest)) {
    parsePackage(rootPath, inDirManifest);
    return packages;
  }
  
  parseDir(rootPath);
  
  return packages;
}

function getFilesNameFromDirList(root_dir, list) {
  
  function searchForLibsInDir(dir, currentPath) {
    var libs = [];
    var files = fs.readdirSync(dir);
    for(var i=0; i<files.length; i++) {
      var file = files[i];
      var fullpath = path.join(dir, file);
      if (fs.statSync(fullpath).isDirectory()) {
        libs = libs.concat(searchForLibsInDir(fullpath, currentPath.concat([file])));
      } else if (path.extname(file)==".js") {
        let name = file.replace(/\.js$/, "");
        libs.push({
          // Full absolute path on the system
          fullFilePath: fullpath,
          // Relative path to the module
          // i.e. path that will be used in require
          path : currentPath.concat([name]).join('/'),
          // Only name of the module
          name : name
        });
      }
    }
    return libs;
  }
  
  var dirs = {};
  for each(var name in list) {
    var dir = path.join(root_dir,name);
    if (!path.existsSync(dir)) throw new Error("Unable to find "+name+" directory in : "+root_dir);
    dirs[name] = searchForLibsInDir(dir,[]);
  }
  
  return dirs;
}

exports.getExtraInfo = function (package) {
  return {
    libs : getFilesNameFromDirList(package.root_dir, package.lib),
    tests : getFilesNameFromDirList(package.root_dir, package.tests),
  };
}
