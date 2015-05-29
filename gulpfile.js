var gulp = require('gulp');
var gutil = require('gulp-util');
var uglify = require('gulp-uglify');
var docco = require('gulp-docco');
var rename = require('gulp-rename');
var browserify = require('browserify');
var coffeeify = require('coffeeify');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');

gulp.task('default', [ 'dist', 'docs' ]);


gulp.task('dist', function() {
  var b = browserify({
    entries: ['src/template'],
    extensions: ['.coffee'],
    transforms: [coffeeify],
    standalone: 'template'
  });

  return b.bundle()
    .on('error', gutil.log)
    .pipe(source('chip-binding.js'))
    .pipe(buffer())
    .pipe(gulp.dest('dist'))
    .pipe(rename('chip-binding.min.js'))
    .pipe(uglify()).on('error', gutil.log)
    .pipe(gulp.dest('dist'))
});



gulp.task('docs', function() {
  return gulp.src('src/*')
    .pipe(docco())
    .pipe(gulp.dest('docs'))
});


gulp.task('watch', [ 'dist' ], function() {
  gulp.watch('src/**/*', [ 'default' ]);
});
