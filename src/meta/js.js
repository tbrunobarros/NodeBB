'use strict';

var path = require('path');
var async = require('async');
var fs = require('fs');
const util = require('util');
var mkdirp = require('mkdirp');
var mkdirpCallback;
if (mkdirp.hasOwnProperty('native')) {
	mkdirpCallback = util.callbackify(mkdirp);
} else {
	mkdirpCallback = mkdirp;
	mkdirp = util.promisify(mkdirp);
}

var rimraf = require('rimraf');

var file = require('../file');
var plugins = require('../plugins');
var minifier = require('./minifier');

var JS = module.exports;

JS.scripts = {
	base: [
		'node_modules/promise-polyfill/dist/polyfill.js',
		'node_modules/socket.io-client/dist/socket.io.js',
		'node_modules/requirejs/require.js',
		'public/src/require-config.js',
		'node_modules/jquery/dist/jquery.js',
		'node_modules/textcomplete/dist/textcomplete.min.js',
		'node_modules/textcomplete.contenteditable/dist/textcomplete.codemirror.min.js',
		'node_modules/visibilityjs/lib/visibility.core.js',
		'node_modules/bootstrap/dist/js/bootstrap.js',
		'node_modules/@adactive/bootstrap-tagsinput/src/bootstrap-tagsinput.js',
		'node_modules/benchpressjs/build/benchpress.js',
		'node_modules/jquery-serializeobject/jquery.serializeObject.js',

		'public/vendor/bootbox/wrapper.js',
		// TODO: remove xregexp on 1.16.0, it is loaded via require
		'public/vendor/xregexp/xregexp.js',
		'public/vendor/xregexp/unicode/unicode-base.js',

		'public/src/utils.js',
		'public/src/sockets.js',
		'public/src/app.js',
		'public/src/ajaxify.js',
		'public/src/overrides.js',
		'public/src/widgets.js',
	],

	// files listed below are only available client-side, or are bundled in to reduce # of network requests on cold load
	rjs: [
		'public/src/client/header/chat.js',
		'public/src/client/header/notifications.js',
		'public/src/client/infinitescroll.js',
		'public/src/client/pagination.js',
		'public/src/client/recent.js',
		'public/src/client/unread.js',
		'public/src/client/topic.js',
		'public/src/client/topic/events.js',
		'public/src/client/topic/posts.js',
		'public/src/client/topic/images.js',
		'public/src/client/topic/votes.js',
		'public/src/client/topic/postTools.js',
		'public/src/client/topic/threadTools.js',
		'public/src/client/categories.js',
		'public/src/client/category.js',
		'public/src/client/category/tools.js',

		'public/src/modules/translator.js',
		'public/src/modules/components.js',
		'public/src/modules/sort.js',
		'public/src/modules/navigator.js',
		'public/src/modules/topicSelect.js',
		'public/src/modules/topicList.js',
		'public/src/modules/categoryFilter.js',
		'public/src/modules/categorySelector.js',
		'public/src/modules/categorySearch.js',
		'public/src/modules/share.js',
		'public/src/modules/alerts.js',
		'public/src/modules/taskbar.js',
		'public/src/modules/helpers.js',
		'public/src/modules/storage.js',
		'public/src/modules/handleBack.js',
	],

	admin: [
		'node_modules/material-design-lite/material.js',
		'public/src/admin/admin.js',
		'node_modules/jquery-deserialize/src/jquery.deserialize.js',
	],

	// modules listed below are built (/src/modules) so they can be defined anonymously
	modules: {
		'Chart.js': 'node_modules/chart.js/dist/Chart.min.js',
		'mousetrap.js': 'node_modules/mousetrap/mousetrap.min.js',
		'cropper.js': 'node_modules/cropperjs/dist/cropper.min.js',
		'jquery-ui': 'node_modules/jquery-ui/ui',
		'zxcvbn.js': 'node_modules/zxcvbn/dist/zxcvbn.js',
		ace: 'node_modules/ace-builds/src-min',
		'clipboard.js': 'node_modules/clipboard/dist/clipboard.min.js',
		'tinycon.js': 'node_modules/tinycon/tinycon.js',
		'slideout.js': 'node_modules/slideout/dist/slideout.min.js',
		'compare-versions.js': 'node_modules/compare-versions/index.js',
		'timeago/locales': 'node_modules/timeago/locales',
		'jquery-form.js': 'node_modules/jquery-form/dist/jquery.form.min.js',
		'xregexp.js': 'node_modules/xregexp/xregexp-all.js',
	},
};

function linkIfLinux(srcPath, destPath, next) {
	if (process.platform === 'win32') {
		fs.copyFile(srcPath, destPath, next);
	} else {
		file.link(srcPath, destPath, true, next);
	}
}

var basePath = path.resolve(__dirname, '../..');

function minifyModules(modules, fork, callback) {
	var moduleDirs = modules.reduce(function (prev, mod) {
		var dir = path.resolve(path.dirname(mod.destPath));
		if (!prev.includes(dir)) {
			prev.push(dir);
		}
		return prev;
	}, []);

	async.each(moduleDirs, mkdirpCallback, function (err) {
		if (err) {
			return callback(err);
		}

		var filtered = modules.reduce(function (prev, mod) {
			if (mod.srcPath.endsWith('.min.js') || path.dirname(mod.srcPath).endsWith('min')) {
				prev.skip.push(mod);
			} else {
				prev.minify.push(mod);
			}

			return prev;
		}, { minify: [], skip: [] });

		async.parallel([
			function (cb) {
				minifier.js.minifyBatch(filtered.minify, fork, cb);
			},
			function (cb) {
				async.each(filtered.skip, function (mod, next) {
					linkIfLinux(mod.srcPath, mod.destPath, next);
				}, cb);
			},
		], callback);
	});
}

function linkModules(callback) {
	var modules = JS.scripts.modules;

	async.each(Object.keys(modules), function (relPath, next) {
		var srcPath = path.join(__dirname, '../../', modules[relPath]);
		var destPath = path.join(__dirname, '../../build/public/src/modules', relPath);

		async.parallel({
			dir: function (cb) {
				mkdirpCallback(path.dirname(destPath), function (err) {
					cb(err);
				});
			},
			stats: function (cb) {
				fs.stat(srcPath, cb);
			},
		}, function (err, res) {
			if (err) {
				return next(err);
			}
			if (res.stats.isDirectory()) {
				return file.linkDirs(srcPath, destPath, true, next);
			}

			linkIfLinux(srcPath, destPath, next);
		});
	}, callback);
}

var moduleDirs = ['modules', 'admin', 'client'];

function getModuleList(callback) {
	var modules = Object.keys(JS.scripts.modules).map(function (relPath) {
		return {
			srcPath: path.join(__dirname, '../../', JS.scripts.modules[relPath]),
			destPath: path.join(__dirname, '../../build/public/src/modules', relPath),
		};
	});

	var coreDirs = moduleDirs.map(function (dir) {
		return {
			srcPath: path.join(__dirname, '../../public/src', dir),
			destPath: path.join(__dirname, '../../build/public/src', dir),
		};
	});

	modules = modules.concat(coreDirs);

	var moduleFiles = [];
	async.each(modules, function (module, next) {
		var srcPath = module.srcPath;
		var destPath = module.destPath;

		fs.stat(srcPath, function (err, stats) {
			if (err) {
				return next(err);
			}
			if (!stats.isDirectory()) {
				moduleFiles.push(module);
				return next();
			}

			file.walk(srcPath, function (err, files) {
				if (err) {
					return next(err);
				}

				var mods = files.filter(function (filePath) {
					return path.extname(filePath) === '.js';
				}).map(function (filePath) {
					return {
						srcPath: path.normalize(filePath),
						destPath: path.join(destPath, path.relative(srcPath, filePath)),
					};
				});

				moduleFiles = moduleFiles.concat(mods).map(function (mod) {
					mod.filename = path.relative(basePath, mod.srcPath).replace(/\\/g, '/');
					return mod;
				});

				next();
			});
		});
	}, function (err) {
		callback(err, moduleFiles);
	});
}

function clearModules(callback) {
	var builtPaths = moduleDirs.map(function (p) {
		return path.join(__dirname, '../../build/public/src', p);
	});
	async.each(builtPaths, function (builtPath, next) {
		rimraf(builtPath, next);
	}, function (err) {
		callback(err);
	});
}

JS.buildModules = function (fork, callback) {
	async.waterfall([
		clearModules,
		function (next) {
			if (process.env.NODE_ENV === 'development') {
				return linkModules(callback);
			}

			getModuleList(next);
		},
		function (modules, next) {
			minifyModules(modules, fork, next);
		},
	], callback);
};

function requirejsOptimize(target, callback) {
	const requirejs = require('requirejs');
	let scriptText = '';
	const sharedCfg = {
		paths: {
			jquery: 'empty:',
		},
		optimize: 'none',
		out: function (text) {
			scriptText += text;
		},
	};
	const bundledModules = [
		{
			baseUrl: './node_modules',
			name: 'timeago/jquery.timeago',
		},
		{
			baseUrl: './node_modules/nprogress',
			name: 'nprogress',
		},
		{
			baseUrl: './node_modules/bootbox',
			name: 'bootbox',
		},
	];
	const targetModules = {
		admin: [
			{
				baseUrl: './node_modules/sortablejs',
				name: 'Sortable',
			},
		],
		client: [

		],
	};
	async.eachSeries(bundledModules.concat(targetModules[target]), function (moduleCfg, next) {
		requirejs.optimize({ ...sharedCfg, ...moduleCfg }, function () {
			next();
		}, function (err) {
			next(err);
		});
	}, function (err) {
		if (err) {
			return callback(err);
		}
		const filePath = path.join(__dirname, '../../build/public/rjs-bundle-' + target + '.js');
		fs.writeFile(filePath, scriptText, callback);
	});
}

JS.linkStatics = function (callback) {
	rimraf(path.join(__dirname, '../../build/public/plugins'), function (err) {
		if (err) {
			return callback(err);
		}
		async.each(Object.keys(plugins.staticDirs), function (mappedPath, next) {
			var sourceDir = plugins.staticDirs[mappedPath];
			var destDir = path.join(__dirname, '../../build/public/plugins', mappedPath);

			mkdirpCallback(path.dirname(destDir), function (err) {
				if (err) {
					return next(err);
				}

				file.linkDirs(sourceDir, destDir, true, next);
			});
		}, callback);
	});
};

function getBundleScriptList(target, callback) {
	var pluginDirectories = [];

	if (target === 'admin') {
		target = 'acp';
	}
	var pluginScripts = plugins[target + 'Scripts'].filter(function (path) {
		if (path.endsWith('.js')) {
			return true;
		}

		pluginDirectories.push(path);
		return false;
	});

	async.each(pluginDirectories, function (directory, next) {
		file.walk(directory, function (err, scripts) {
			if (err) {
				return next(err);
			}

			pluginScripts = pluginScripts.concat(scripts);
			next();
		});
	}, function (err) {
		if (err) {
			return callback(err);
		}

		var scripts = JS.scripts.base;

		if (target === 'client' && process.env.NODE_ENV !== 'development') {
			scripts = scripts.concat(JS.scripts.rjs);
		} else if (target === 'acp') {
			scripts = scripts.concat(JS.scripts.admin);
		}

		scripts = scripts.concat(pluginScripts).map(function (script) {
			var srcPath = path.resolve(basePath, script).replace(/\\/g, '/');
			return {
				srcPath: srcPath,
				filename: path.relative(basePath, srcPath).replace(/\\/g, '/'),
			};
		});

		callback(null, scripts);
	});
}

JS.buildBundle = function (target, fork, callback) {
	var fileNames = {
		client: 'nodebb.min.js',
		admin: 'acp.min.js',
	};

	async.waterfall([
		function (next) {
			requirejsOptimize(target, next);
		},
		function (next) {
			getBundleScriptList(target, next);
		},
		function (files, next) {
			mkdirpCallback(path.join(__dirname, '../../build/public'), function (err) {
				next(err, files);
			});
		},
		function (files, next) {
			files.push({
				srcPath: path.join(__dirname, '../../build/public/rjs-bundle-' + target + '.js'),
			});

			var minify = process.env.NODE_ENV !== 'development';
			var filePath = path.join(__dirname, '../../build/public', fileNames[target]);

			minifier.js.bundle({
				files: files,
				filename: fileNames[target],
				destPath: filePath,
			}, minify, fork, next);
		},
	], callback);
};

JS.killMinifier = function () {
	minifier.killAll();
};
