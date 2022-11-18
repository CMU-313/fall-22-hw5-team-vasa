/** !
 * ================================================================
 * Teedy patch applied to encode filenames with encodeURIComponent.
 * ================================================================
 *
 * AngularJS file upload directives and services. Supoorts: file upload/drop/paste, resume, cancel/abort,
 * progress, resize, thumbnail, preview, validation and CORS
 * @author  Danial  <danial.farid@gmail.com>
 * @version 12.2.13
 */

if (window.XMLHttpRequest && !(window.FileAPI && FileAPI.shouldLoad)) {
  window.XMLHttpRequest.prototype.setRequestHeader = (function (orig) {
    return function (header, value) {
      if (header === '__setXHR_') {
        const val = value(this)
        // fix for angular < 1.2.0
        if (val instanceof Function) {
          val(this)
        }
      } else {
        orig.apply(this, arguments)
      }
    }
  })(window.XMLHttpRequest.prototype.setRequestHeader)
}

const ngFileUpload = angular.module('ngFileUpload', [])

ngFileUpload.version = '12.2.13'

ngFileUpload.service('UploadBase', ['$http', '$q', '$timeout', function ($http, $q, $timeout) {
  const upload = this
  upload.promisesCount = 0

  this.isResumeSupported = function () {
    return window.Blob && window.Blob.prototype.slice
  }

  const resumeSupported = this.isResumeSupported()

  function sendHttp (config) {
    config.method = config.method || 'POST'
    config.headers = config.headers || {}

    const deferred = config._deferred = config._deferred || $q.defer()
    const promise = deferred.promise

    function notifyProgress (e) {
      if (deferred.notify) {
        deferred.notify(e)
      }
      if (promise.progressFunc) {
        $timeout(function () {
          promise.progressFunc(e)
        })
      }
    }

    function getNotifyEvent (n) {
      if (config._start != null && resumeSupported) {
        return {
          loaded: n.loaded + config._start,
          total: (config._file && config._file.size) || n.total,
          type: n.type,
          config,
          lengthComputable: true,
          target: n.target
        }
      } else {
        return n
      }
    }

    if (!config.disableProgress) {
      config.headers.__setXHR_ = function () {
        return function (xhr) {
          if (!xhr || !xhr.upload || !xhr.upload.addEventListener) return
          config.__XHR = xhr
          if (config.xhrFn) config.xhrFn(xhr)
          xhr.upload.addEventListener('progress', function (e) {
            e.config = config
            notifyProgress(getNotifyEvent(e))
          }, false)
          // fix for firefox not firing upload progress end, also IE8-9
          xhr.upload.addEventListener('load', function (e) {
            if (e.lengthComputable) {
              e.config = config
              notifyProgress(getNotifyEvent(e))
            }
          }, false)
        }
      }
    }

    function uploadWithAngular () {
      $http(config).then(function (r) {
        if (resumeSupported && config._chunkSize && !config._finished && config._file) {
          const fileSize = config._file && config._file.size || 0
          notifyProgress({
            loaded: Math.min(config._end, fileSize),
            total: fileSize,
            config,
            type: 'progress'
          }
          )
          upload.upload(config, true)
        } else {
          if (config._finished) delete config._finished
          deferred.resolve(r)
        }
      }, function (e) {
        deferred.reject(e)
      }, function (n) {
        deferred.notify(n)
      }
      )
    }

    if (!resumeSupported) {
      uploadWithAngular()
    } else if (config._chunkSize && config._end && !config._finished) {
      config._start = config._end
      config._end += config._chunkSize
      uploadWithAngular()
    } else if (config.resumeSizeUrl) {
      $http.get(config.resumeSizeUrl).then(function (resp) {
        if (config.resumeSizeResponseReader) {
          config._start = config.resumeSizeResponseReader(resp.data)
        } else {
          config._start = parseInt((resp.data.size == null ? resp.data : resp.data.size).toString())
        }
        if (config._chunkSize) {
          config._end = config._start + config._chunkSize
        }
        uploadWithAngular()
      }, function (e) {
        throw e
      })
    } else if (config.resumeSize) {
      config.resumeSize().then(function (size) {
        config._start = size
        if (config._chunkSize) {
          config._end = config._start + config._chunkSize
        }
        uploadWithAngular()
      }, function (e) {
        throw e
      })
    } else {
      if (config._chunkSize) {
        config._start = 0
        config._end = config._start + config._chunkSize
      }
      uploadWithAngular()
    }

    promise.success = function (fn) {
      promise.then(function (response) {
        fn(response.data, response.status, response.headers, config)
      })
      return promise
    }

    promise.error = function (fn) {
      promise.then(null, function (response) {
        fn(response.data, response.status, response.headers, config)
      })
      return promise
    }

    promise.progress = function (fn) {
      promise.progressFunc = fn
      promise.then(null, null, function (n) {
        fn(n)
      })
      return promise
    }
    promise.abort = promise.pause = function () {
      if (config.__XHR) {
        $timeout(function () {
          config.__XHR.abort()
        })
      }
      return promise
    }
    promise.xhr = function (fn) {
      config.xhrFn = (function (origXhrFn) {
        return function () {
          if (origXhrFn) origXhrFn.apply(promise, arguments)
          fn.apply(promise, arguments)
        }
      })(config.xhrFn)
      return promise
    }

    upload.promisesCount++
    if (promise.finally && promise.finally instanceof Function) {
      promise.finally(function () {
        upload.promisesCount--
      })
    }
    return promise
  }

  this.isUploadInProgress = function () {
    return upload.promisesCount > 0
  }

  this.rename = function (file, name) {
    file.ngfName = name
    return file
  }

  this.jsonBlob = function (val) {
    if (val != null && !angular.isString(val)) {
      val = JSON.stringify(val)
    }
    const blob = new window.Blob([val], { type: 'application/json' })
    blob._ngfBlob = true
    return blob
  }

  this.json = function (val) {
    return angular.toJson(val)
  }

  function copy (obj) {
    const clone = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clone[key] = obj[key]
      }
    }
    return clone
  }

  this.isFile = function (file) {
    return file != null && (file instanceof window.Blob || (file.flashId && file.name && file.size))
  }

  this.upload = function (config, internal) {
    function toResumeFile (file, formData) {
      if (file._ngfBlob) return file
      config._file = config._file || file
      if (config._start != null && resumeSupported) {
        if (config._end && config._end >= file.size) {
          config._finished = true
          config._end = file.size
        }
        const slice = file.slice(config._start, config._end || file.size)
        slice.name = file.name
        slice.ngfName = file.ngfName
        if (config._chunkSize) {
          formData.append('_chunkSize', config._chunkSize)
          formData.append('_currentChunkSize', config._end - config._start)
          formData.append('_chunkNumber', Math.floor(config._start / config._chunkSize))
          formData.append('_totalSize', config._file.size)
        }
        return slice
      }
      return file
    }

    function addFieldToFormData (formData, val, key) {
      if (val !== undefined) {
        if (angular.isDate(val)) {
          val = val.toISOString()
        }
        if (angular.isString(val)) {
          formData.append(key, val)
        } else if (upload.isFile(val)) {
          const file = toResumeFile(val, formData)
          const split = key.split(',')
          if (split[1]) {
            file.ngfName = split[1].replace(/^\s+|\s+$/g, '')
            key = split[0]
          }
          config._fileKey = config._fileKey || key
          formData.append(key, file, file.ngfName || encodeURIComponent(file.name))
        } else {
          if (angular.isObject(val)) {
            if (val.$$ngfCircularDetection) throw 'ngFileUpload: Circular reference in config.data. Make sure specified data for Upload.upload() has no circular reference: ' + key

            val.$$ngfCircularDetection = true
            try {
              for (const k in val) {
                if (val.hasOwnProperty(k) && k !== '$$ngfCircularDetection') {
                  let objectKey = config.objectKey == null ? '[i]' : config.objectKey
                  if (val.length && parseInt(k) > -1) {
                    objectKey = config.arrayKey == null ? objectKey : config.arrayKey
                  }
                  addFieldToFormData(formData, val[k], key + objectKey.replace(/[ik]/g, k))
                }
              }
            } finally {
              delete val.$$ngfCircularDetection
            }
          } else {
            formData.append(key, val)
          }
        }
      }
    }

    function digestConfig () {
      config._chunkSize = upload.translateScalars(config.resumeChunkSize)
      config._chunkSize = config._chunkSize ? parseInt(config._chunkSize.toString()) : null

      config.headers = config.headers || {}
      config.headers['Content-Type'] = undefined
      config.transformRequest = config.transformRequest
        ? (angular.isArray(config.transformRequest)
            ? config.transformRequest
            : [config.transformRequest])
        : []
      config.transformRequest.push(function (data) {
        const formData = new window.FormData(); let key
        data = data || config.fields || {}
        if (config.file) {
          data.file = config.file
        }
        for (key in data) {
          if (data.hasOwnProperty(key)) {
            const val = data[key]
            if (config.formDataAppender) {
              config.formDataAppender(formData, key, val)
            } else {
              addFieldToFormData(formData, val, key)
            }
          }
        }

        return formData
      })
    }

    if (!internal) config = copy(config)
    if (!config._isDigested) {
      config._isDigested = true
      digestConfig()
    }

    return sendHttp(config)
  }

  this.http = function (config) {
    config = copy(config)
    config.transformRequest = config.transformRequest || function (data) {
      if ((window.ArrayBuffer && data instanceof window.ArrayBuffer) || data instanceof window.Blob) {
        return data
      }
      return $http.defaults.transformRequest[0].apply(this, arguments)
    }
    config._chunkSize = upload.translateScalars(config.resumeChunkSize)
    config._chunkSize = config._chunkSize ? parseInt(config._chunkSize.toString()) : null

    return sendHttp(config)
  }

  this.translateScalars = function (str) {
    if (angular.isString(str)) {
      if (str.search(/kb/i) === str.length - 2) {
        return parseFloat(str.substring(0, str.length - 2) * 1024)
      } else if (str.search(/mb/i) === str.length - 2) {
        return parseFloat(str.substring(0, str.length - 2) * 1048576)
      } else if (str.search(/gb/i) === str.length - 2) {
        return parseFloat(str.substring(0, str.length - 2) * 1073741824)
      } else if (str.search(/b/i) === str.length - 1) {
        return parseFloat(str.substring(0, str.length - 1))
      } else if (str.search(/s/i) === str.length - 1) {
        return parseFloat(str.substring(0, str.length - 1))
      } else if (str.search(/m/i) === str.length - 1) {
        return parseFloat(str.substring(0, str.length - 1) * 60)
      } else if (str.search(/h/i) === str.length - 1) {
        return parseFloat(str.substring(0, str.length - 1) * 3600)
      }
    }
    return str
  }

  this.urlToBlob = function (url) {
    const defer = $q.defer()
    $http({ url, method: 'get', responseType: 'arraybuffer' }).then(function (resp) {
      const arrayBufferView = new Uint8Array(resp.data)
      const type = resp.headers('content-type') || 'image/WebP'
      const blob = new window.Blob([arrayBufferView], { type })
      const matches = url.match(/.*\/(.+?)(\?.*)?$/)
      if (matches.length > 1) {
        blob.name = matches[1]
      }
      defer.resolve(blob)
    }, function (e) {
      defer.reject(e)
    })
    return defer.promise
  }

  this.setDefaults = function (defaults) {
    this.defaults = defaults || {}
  }

  this.defaults = {}
  this.version = ngFileUpload.version
}

])

ngFileUpload.service('Upload', ['$parse', '$timeout', '$compile', '$q', 'UploadExif', function ($parse, $timeout, $compile, $q, UploadExif) {
  const upload = UploadExif
  upload.getAttrWithDefaults = function (attr, name) {
    if (attr[name] != null) return attr[name]
    const def = upload.defaults[name]
    return (def == null ? def : (angular.isString(def) ? def : JSON.stringify(def)))
  }

  upload.attrGetter = function (name, attr, scope, params) {
    const attrVal = this.getAttrWithDefaults(attr, name)
    if (scope) {
      try {
        if (params) {
          return $parse(attrVal)(scope, params)
        } else {
          return $parse(attrVal)(scope)
        }
      } catch (e) {
        // hangle string value without single qoute
        if (name.search(/min|max|pattern/i)) {
          return attrVal
        } else {
          throw e
        }
      }
    } else {
      return attrVal
    }
  }

  upload.shouldUpdateOn = function (type, attr, scope) {
    const modelOptions = upload.attrGetter('ngfModelOptions', attr, scope)
    if (modelOptions && modelOptions.updateOn) {
      return modelOptions.updateOn.split(' ').indexOf(type) > -1
    }
    return true
  }

  upload.emptyPromise = function () {
    const d = $q.defer()
    const args = arguments
    $timeout(function () {
      d.resolve.apply(d, args)
    })
    return d.promise
  }

  upload.rejectPromise = function () {
    const d = $q.defer()
    const args = arguments
    $timeout(function () {
      d.reject.apply(d, args)
    })
    return d.promise
  }

  upload.happyPromise = function (promise, data) {
    const d = $q.defer()
    promise.then(function (result) {
      d.resolve(result)
    }, function (error) {
      $timeout(function () {
        throw error
      })
      d.resolve(data)
    })
    return d.promise
  }

  function applyExifRotations (files, attr, scope) {
    const promises = [upload.emptyPromise()]
    angular.forEach(files, function (f, i) {
      if (f.type.indexOf('image/jpeg') === 0 && upload.attrGetter('ngfFixOrientation', attr, scope, { $file: f })) {
        promises.push(upload.happyPromise(upload.applyExifRotation(f), f).then(function (fixedFile) {
          files.splice(i, 1, fixedFile)
        }))
      }
    })
    return $q.all(promises)
  }

  function resizeFile (files, attr, scope, ngModel) {
    const resizeVal = upload.attrGetter('ngfResize', attr, scope)
    if (!resizeVal || !upload.isResizeSupported() || !files.length) return upload.emptyPromise()
    if (resizeVal instanceof Function) {
      const defer = $q.defer()
      return resizeVal(files).then(function (p) {
        resizeWithParams(p, files, attr, scope, ngModel).then(function (r) {
          defer.resolve(r)
        }, function (e) {
          defer.reject(e)
        })
      }, function (e) {
        defer.reject(e)
      })
    } else {
      return resizeWithParams(resizeVal, files, attr, scope, ngModel)
    }
  }

  function resizeWithParams (params, files, attr, scope, ngModel) {
    const promises = [upload.emptyPromise()]

    function handleFile (f, i) {
      if (f.type.indexOf('image') === 0) {
        if (params.pattern && !upload.validatePattern(f, params.pattern)) return
        params.resizeIf = function (width, height) {
          return upload.attrGetter('ngfResizeIf', attr, scope,
            { $width: width, $height: height, $file: f })
        }
        const promise = upload.resize(f, params)
        promises.push(promise)
        promise.then(function (resizedFile) {
          files.splice(i, 1, resizedFile)
        }, function (e) {
          f.$error = 'resize';
          (f.$errorMessages = (f.$errorMessages || {})).resize = true
          f.$errorParam = (e ? (e.message ? e.message : e) + ': ' : '') + (f && f.name)
          ngModel.$ngfValidations.push({ name: 'resize', valid: false })
          upload.applyModelValidation(ngModel, files)
        })
      }
    }

    for (let i = 0; i < files.length; i++) {
      handleFile(files[i], i)
    }
    return $q.all(promises)
  }

  upload.updateModel = function (ngModel, attr, scope, fileChange, files, evt, noDelay) {
    function update (files, invalidFiles, newFiles, dupFiles, isSingleModel) {
      attr.$$ngfPrevValidFiles = files
      attr.$$ngfPrevInvalidFiles = invalidFiles
      const file = files && files.length ? files[0] : null
      const invalidFile = invalidFiles && invalidFiles.length ? invalidFiles[0] : null

      if (ngModel) {
        upload.applyModelValidation(ngModel, files)
        ngModel.$setViewValue(isSingleModel ? file : files)
      }

      if (fileChange) {
        $parse(fileChange)(scope, {
          $files: files,
          $file: file,
          $newFiles: newFiles,
          $duplicateFiles: dupFiles,
          $invalidFiles: invalidFiles,
          $invalidFile: invalidFile,
          $event: evt
        })
      }

      const invalidModel = upload.attrGetter('ngfModelInvalid', attr)
      if (invalidModel) {
        $timeout(function () {
          $parse(invalidModel).assign(scope, isSingleModel ? invalidFile : invalidFiles)
        })
      }
      $timeout(function () {
        // scope apply changes
      })
    }

    let allNewFiles; let dupFiles = []; let prevValidFiles; let prevInvalidFiles
    let invalids = []; let valids = []

    function removeDuplicates () {
      function equals (f1, f2) {
        return f1.name === f2.name && (f1.$ngfOrigSize || f1.size) === (f2.$ngfOrigSize || f2.size) &&
          f1.type === f2.type
      }

      function isInPrevFiles (f) {
        let j
        for (j = 0; j < prevValidFiles.length; j++) {
          if (equals(f, prevValidFiles[j])) {
            return true
          }
        }
        for (j = 0; j < prevInvalidFiles.length; j++) {
          if (equals(f, prevInvalidFiles[j])) {
            return true
          }
        }
        return false
      }

      if (files) {
        allNewFiles = []
        dupFiles = []
        for (let i = 0; i < files.length; i++) {
          if (isInPrevFiles(files[i])) {
            dupFiles.push(files[i])
          } else {
            allNewFiles.push(files[i])
          }
        }
      }
    }

    function toArray (v) {
      return angular.isArray(v) ? v : [v]
    }

    function resizeAndUpdate () {
      function updateModel () {
        $timeout(function () {
          update(keep ? prevValidFiles.concat(valids) : valids,
            keep ? prevInvalidFiles.concat(invalids) : invalids,
            files, dupFiles, isSingleModel)
        }, options && options.debounce ? options.debounce.change || options.debounce : 0)
      }

      const resizingFiles = validateAfterResize ? allNewFiles : valids
      resizeFile(resizingFiles, attr, scope, ngModel).then(function () {
        if (validateAfterResize) {
          upload.validate(allNewFiles, keep ? prevValidFiles.length : 0, ngModel, attr, scope)
            .then(function (validationResult) {
              valids = validationResult.validsFiles
              invalids = validationResult.invalidsFiles
              updateModel()
            })
        } else {
          updateModel()
        }
      }, function () {
        for (let i = 0; i < resizingFiles.length; i++) {
          const f = resizingFiles[i]
          if (f.$error === 'resize') {
            const index = valids.indexOf(f)
            if (index > -1) {
              valids.splice(index, 1)
              invalids.push(f)
            }
            updateModel()
          }
        }
      })
    }

    prevValidFiles = attr.$$ngfPrevValidFiles || []
    prevInvalidFiles = attr.$$ngfPrevInvalidFiles || []
    if (ngModel && ngModel.$modelValue) {
      prevValidFiles = toArray(ngModel.$modelValue)
    }

    var keep = upload.attrGetter('ngfKeep', attr, scope)
    allNewFiles = (files || []).slice(0)
    if (keep === 'distinct' || upload.attrGetter('ngfKeepDistinct', attr, scope) === true) {
      removeDuplicates(attr, scope)
    }

    var isSingleModel = !keep && !upload.attrGetter('ngfMultiple', attr, scope) && !upload.attrGetter('multiple', attr)

    if (keep && !allNewFiles.length) return

    upload.attrGetter('ngfBeforeModelChange', attr, scope, {
      $files: files,
      $file: files && files.length ? files[0] : null,
      $newFiles: allNewFiles,
      $duplicateFiles: dupFiles,
      $event: evt
    })

    var validateAfterResize = upload.attrGetter('ngfValidateAfterResize', attr, scope)

    var options = upload.attrGetter('ngfModelOptions', attr, scope)
    upload.validate(allNewFiles, keep ? prevValidFiles.length : 0, ngModel, attr, scope)
      .then(function (validationResult) {
        if (noDelay) {
          update(allNewFiles, [], files, dupFiles, isSingleModel)
        } else {
          if ((!options || !options.allowInvalid) && !validateAfterResize) {
            valids = validationResult.validFiles
            invalids = validationResult.invalidFiles
          } else {
            valids = allNewFiles
          }
          if (upload.attrGetter('ngfFixOrientation', attr, scope) && upload.isExifSupported()) {
            applyExifRotations(valids, attr, scope).then(function () {
              resizeAndUpdate()
            })
          } else {
            resizeAndUpdate()
          }
        }
      })
  }

  return upload
}])

ngFileUpload.directive('ngfSelect', ['$parse', '$timeout', '$compile', 'Upload', function ($parse, $timeout, $compile, Upload) {
  const generatedElems = []

  function isDelayedClickSupported (ua) {
    // fix for android native browser < 4.4 and safari windows
    const m = ua.match(/Android[^\d]*(\d+)\.(\d+)/)
    if (m && m.length > 2) {
      const v = Upload.defaults.androidFixMinorVersion || 4
      return parseInt(m[1]) < 4 || (parseInt(m[1]) === v && parseInt(m[2]) < v)
    }

    // safari on windows
    return ua.indexOf('Chrome') === -1 && /.*Windows.*Safari.*/.test(ua)
  }

  function linkFileSelect (scope, elem, attr, ngModel, $parse, $timeout, $compile, upload) {
    /** @namespace attr.ngfSelect */
    /** @namespace attr.ngfChange */
    /** @namespace attr.ngModel */
    /** @namespace attr.ngfModelOptions */
    /** @namespace attr.ngfMultiple */
    /** @namespace attr.ngfCapture */
    /** @namespace attr.ngfValidate */
    /** @namespace attr.ngfKeep */
    const attrGetter = function (name, scope) {
      return upload.attrGetter(name, attr, scope)
    }

    function isInputTypeFile () {
      return elem[0].tagName.toLowerCase() === 'input' && attr.type && attr.type.toLowerCase() === 'file'
    }

    function fileChangeAttr () {
      return attrGetter('ngfChange') || attrGetter('ngfSelect')
    }

    function changeFn (evt) {
      if (upload.shouldUpdateOn('change', attr, scope)) {
        const fileList = evt.__files_ || (evt.target && evt.target.files); const files = []
        /* Handle duplicate call in  IE11 */
        if (!fileList) return
        for (let i = 0; i < fileList.length; i++) {
          files.push(fileList[i])
        }
        upload.updateModel(ngModel, attr, scope, fileChangeAttr(),
          files.length ? files : null, evt)
      }
    }

    upload.registerModelChangeValidator(ngModel, attr, scope)

    const unwatches = []
    if (attrGetter('ngfMultiple')) {
      unwatches.push(scope.$watch(attrGetter('ngfMultiple'), function () {
        fileElem.attr('multiple', attrGetter('ngfMultiple', scope))
      }))
    }
    if (attrGetter('ngfCapture')) {
      unwatches.push(scope.$watch(attrGetter('ngfCapture'), function () {
        fileElem.attr('capture', attrGetter('ngfCapture', scope))
      }))
    }
    if (attrGetter('ngfAccept')) {
      unwatches.push(scope.$watch(attrGetter('ngfAccept'), function () {
        fileElem.attr('accept', attrGetter('ngfAccept', scope))
      }))
    }
    unwatches.push(attr.$observe('accept', function () {
      fileElem.attr('accept', attrGetter('accept'))
    }))
    function bindAttrToFileInput (fileElem, label) {
      function updateId (val) {
        fileElem.attr('id', 'ngf-' + val)
        label.attr('id', 'ngf-label-' + val)
      }

      for (let i = 0; i < elem[0].attributes.length; i++) {
        const attribute = elem[0].attributes[i]
        if (attribute.name !== 'type' && attribute.name !== 'class' && attribute.name !== 'style') {
          if (attribute.name === 'id') {
            updateId(attribute.value)
            unwatches.push(attr.$observe('id', updateId))
          } else {
            fileElem.attr(attribute.name, (!attribute.value && (attribute.name === 'required' ||
              attribute.name === 'multiple'))
              ? attribute.name
              : attribute.value)
          }
        }
      }
    }

    function createFileInput () {
      if (isInputTypeFile()) {
        return elem
      }

      const fileElem = angular.element('<input type="file">')

      const label = angular.element('<label>upload</label>')
      label.css('visibility', 'hidden').css('position', 'absolute').css('overflow', 'hidden')
        .css('width', '0px').css('height', '0px').css('border', 'none')
        .css('margin', '0px').css('padding', '0px').attr('tabindex', '-1')
      bindAttrToFileInput(fileElem, label)

      generatedElems.push({ el: elem, ref: label })

      document.body.appendChild(label.append(fileElem)[0])

      return fileElem
    }

    function clickHandler (evt) {
      if (elem.attr('disabled')) return false
      if (attrGetter('ngfSelectDisabled', scope)) return

      const r = detectSwipe(evt)
      // prevent the click if it is a swipe
      if (r != null) return r

      resetModel(evt)

      // fix for md when the element is removed from the DOM and added back #460
      try {
        if (!isInputTypeFile() && !document.body.contains(fileElem[0])) {
          generatedElems.push({ el: elem, ref: fileElem.parent() })
          document.body.appendChild(fileElem.parent()[0])
          fileElem.bind('change', changeFn)
        }
      } catch (e) { /* ignore */
      }

      if (isDelayedClickSupported(navigator.userAgent)) {
        setTimeout(function () {
          fileElem[0].click()
        }, 0)
      } else {
        fileElem[0].click()
      }

      return false
    }

    let initialTouchStartY = 0
    let initialTouchStartX = 0

    function detectSwipe (evt) {
      const touches = evt.changedTouches || (evt.originalEvent && evt.originalEvent.changedTouches)
      if (touches) {
        if (evt.type === 'touchstart') {
          initialTouchStartX = touches[0].clientX
          initialTouchStartY = touches[0].clientY
          return true // don't block event default
        } else {
          // prevent scroll from triggering event
          if (evt.type === 'touchend') {
            const currentX = touches[0].clientX
            const currentY = touches[0].clientY
            if ((Math.abs(currentX - initialTouchStartX) > 20) ||
              (Math.abs(currentY - initialTouchStartY) > 20)) {
              evt.stopPropagation()
              evt.preventDefault()
              return false
            }
          }
          return true
        }
      }
    }

    var fileElem = elem

    function resetModel (evt) {
      if (upload.shouldUpdateOn('click', attr, scope) && fileElem.val()) {
        fileElem.val(null)
        upload.updateModel(ngModel, attr, scope, fileChangeAttr(), null, evt, true)
      }
    }

    if (!isInputTypeFile()) {
      fileElem = createFileInput()
    }
    fileElem.bind('change', changeFn)

    if (!isInputTypeFile()) {
      elem.bind('click touchstart touchend', clickHandler)
    } else {
      elem.bind('click', resetModel)
    }

    function ie10SameFileSelectFix (evt) {
      if (fileElem && !fileElem.attr('__ngf_ie10_Fix_')) {
        if (!fileElem[0].parentNode) {
          fileElem = null
          return
        }
        evt.preventDefault()
        evt.stopPropagation()
        fileElem.unbind('click')
        const clone = fileElem.clone()
        fileElem.replaceWith(clone)
        fileElem = clone
        fileElem.attr('__ngf_ie10_Fix_', 'true')
        fileElem.bind('change', changeFn)
        fileElem.bind('click', ie10SameFileSelectFix)
        fileElem[0].click()
        return false
      } else {
        fileElem.removeAttr('__ngf_ie10_Fix_')
      }
    }

    if (navigator.appVersion.indexOf('MSIE 10') !== -1) {
      fileElem.bind('click', ie10SameFileSelectFix)
    }

    if (ngModel) {
      ngModel.$formatters.push(function (val) {
        if (val == null || val.length === 0) {
          if (fileElem.val()) {
            fileElem.val(null)
          }
        }
        return val
      })
    }

    scope.$on('$destroy', function () {
      if (!isInputTypeFile()) fileElem.parent().remove()
      angular.forEach(unwatches, function (unwatch) {
        unwatch()
      })
    })

    $timeout(function () {
      for (let i = 0; i < generatedElems.length; i++) {
        const g = generatedElems[i]
        if (!document.body.contains(g.el[0])) {
          generatedElems.splice(i, 1)
          g.ref.remove()
        }
      }
    })

    if (window.FileAPI && window.FileAPI.ngfFixIE) {
      window.FileAPI.ngfFixIE(elem, fileElem, changeFn)
    }
  }

  return {
    restrict: 'AEC',
    require: '?ngModel',
    link: function (scope, elem, attr, ngModel) {
      linkFileSelect(scope, elem, attr, ngModel, $parse, $timeout, $compile, Upload)
    }
  }
}]);

(function () {
  ngFileUpload.service('UploadDataUrl', ['UploadBase', '$timeout', '$q', function (UploadBase, $timeout, $q) {
    const upload = UploadBase
    upload.base64DataUrl = function (file) {
      if (angular.isArray(file)) {
        const d = $q.defer(); let count = 0
        angular.forEach(file, function (f) {
          upload.dataUrl(f, true).finally(function () {
            count++
            if (count === file.length) {
              const urls = []
              angular.forEach(file, function (ff) {
                urls.push(ff.$ngfDataUrl)
              })
              d.resolve(urls, file)
            }
          })
        })
        return d.promise
      } else {
        return upload.dataUrl(file, true)
      }
    }
    upload.dataUrl = function (file, disallowObjectUrl) {
      if (!file) return upload.emptyPromise(file, file)
      if ((disallowObjectUrl && file.$ngfDataUrl != null) || (!disallowObjectUrl && file.$ngfBlobUrl != null)) {
        return upload.emptyPromise(disallowObjectUrl ? file.$ngfDataUrl : file.$ngfBlobUrl, file)
      }
      let p = disallowObjectUrl ? file.$$ngfDataUrlPromise : file.$$ngfBlobUrlPromise
      if (p) return p

      const deferred = $q.defer()
      $timeout(function () {
        if (window.FileReader && file &&
          (!window.FileAPI || navigator.userAgent.indexOf('MSIE 8') === -1 || file.size < 20000) &&
          (!window.FileAPI || navigator.userAgent.indexOf('MSIE 9') === -1 || file.size < 4000000)) {
          // prefer URL.createObjectURL for handling refrences to files of all sizes
          // since it doesn´t build a large string in memory
          const URL = window.URL || window.webkitURL
          if (URL && URL.createObjectURL && !disallowObjectUrl) {
            let url
            try {
              url = URL.createObjectURL(file)
            } catch (e) {
              $timeout(function () {
                file.$ngfBlobUrl = ''
                deferred.reject()
              })
              return
            }
            $timeout(function () {
              file.$ngfBlobUrl = url
              if (url) {
                deferred.resolve(url, file)
                upload.blobUrls = upload.blobUrls || []
                upload.blobUrlsTotalSize = upload.blobUrlsTotalSize || 0
                upload.blobUrls.push({ url, size: file.size })
                upload.blobUrlsTotalSize += file.size || 0
                const maxMemory = upload.defaults.blobUrlsMaxMemory || 268435456
                const maxLength = upload.defaults.blobUrlsMaxQueueSize || 200
                while ((upload.blobUrlsTotalSize > maxMemory || upload.blobUrls.length > maxLength) && upload.blobUrls.length > 1) {
                  const obj = upload.blobUrls.splice(0, 1)[0]
                  URL.revokeObjectURL(obj.url)
                  upload.blobUrlsTotalSize -= obj.size
                }
              }
            })
          } else {
            const fileReader = new FileReader()
            fileReader.onload = function (e) {
              $timeout(function () {
                file.$ngfDataUrl = e.target.result
                deferred.resolve(e.target.result, file)
                $timeout(function () {
                  delete file.$ngfDataUrl
                }, 1000)
              })
            }
            fileReader.onerror = function () {
              $timeout(function () {
                file.$ngfDataUrl = ''
                deferred.reject()
              })
            }
            fileReader.readAsDataURL(file)
          }
        } else {
          $timeout(function () {
            file[disallowObjectUrl ? '$ngfDataUrl' : '$ngfBlobUrl'] = ''
            deferred.reject()
          })
        }
      })

      if (disallowObjectUrl) {
        p = file.$$ngfDataUrlPromise = deferred.promise
      } else {
        p = file.$$ngfBlobUrlPromise = deferred.promise
      }
      p.finally(function () {
        delete file[disallowObjectUrl ? '$$ngfDataUrlPromise' : '$$ngfBlobUrlPromise']
      })
      return p
    }
    return upload
  }])

  function getTagType (el) {
    if (el.tagName.toLowerCase() === 'img') return 'image'
    if (el.tagName.toLowerCase() === 'audio') return 'audio'
    if (el.tagName.toLowerCase() === 'video') return 'video'
    return /./
  }

  function linkFileDirective (Upload, $timeout, scope, elem, attr, directiveName, resizeParams, isBackground) {
    function constructDataUrl (file) {
      const disallowObjectUrl = Upload.attrGetter('ngfNoObjectUrl', attr, scope)
      Upload.dataUrl(file, disallowObjectUrl).finally(function () {
        $timeout(function () {
          const src = (disallowObjectUrl ? file.$ngfDataUrl : file.$ngfBlobUrl) || file.$ngfDataUrl
          if (isBackground) {
            elem.css('background-image', 'url(\'' + (src || '') + '\')')
          } else {
            elem.attr('src', src)
          }
          if (src) {
            elem.removeClass('ng-hide')
          } else {
            elem.addClass('ng-hide')
          }
        })
      })
    }

    $timeout(function () {
      const unwatch = scope.$watch(attr[directiveName], function (file) {
        let size = resizeParams
        if (directiveName === 'ngfThumbnail') {
          if (!size) {
            size = {
              width: elem[0].naturalWidth || elem[0].clientWidth,
              height: elem[0].naturalHeight || elem[0].clientHeight
            }
          }
          if (size.width === 0 && window.getComputedStyle) {
            const style = getComputedStyle(elem[0])
            if (style.width && style.width.indexOf('px') > -1 && style.height && style.height.indexOf('px') > -1) {
              size = {
                width: parseInt(style.width.slice(0, -2)),
                height: parseInt(style.height.slice(0, -2))
              }
            }
          }
        }

        if (angular.isString(file)) {
          elem.removeClass('ng-hide')
          if (isBackground) {
            return elem.css('background-image', 'url(\'' + file + '\')')
          } else {
            return elem.attr('src', file)
          }
        }
        if (file && file.type && file.type.search(getTagType(elem[0])) === 0 &&
          (!isBackground || file.type.indexOf('image') === 0)) {
          if (size && Upload.isResizeSupported()) {
            size.resizeIf = function (width, height) {
              return Upload.attrGetter('ngfResizeIf', attr, scope,
                { $width: width, $height: height, $file: file })
            }
            Upload.resize(file, size).then(
              function (f) {
                constructDataUrl(f)
              }, function (e) {
                throw e
              }
            )
          } else {
            constructDataUrl(file)
          }
        } else {
          elem.addClass('ng-hide')
        }
      })

      scope.$on('$destroy', function () {
        unwatch()
      })
    })
  }

  /** @namespace attr.ngfSrc */
  /** @namespace attr.ngfNoObjectUrl */
  ngFileUpload.directive('ngfSrc', ['Upload', '$timeout', function (Upload, $timeout) {
    return {
      restrict: 'AE',
      link: function (scope, elem, attr) {
        linkFileDirective(Upload, $timeout, scope, elem, attr, 'ngfSrc',
          Upload.attrGetter('ngfResize', attr, scope), false)
      }
    }
  }])

  /** @namespace attr.ngfBackground */
  /** @namespace attr.ngfNoObjectUrl */
  ngFileUpload.directive('ngfBackground', ['Upload', '$timeout', function (Upload, $timeout) {
    return {
      restrict: 'AE',
      link: function (scope, elem, attr) {
        linkFileDirective(Upload, $timeout, scope, elem, attr, 'ngfBackground',
          Upload.attrGetter('ngfResize', attr, scope), true)
      }
    }
  }])

  /** @namespace attr.ngfThumbnail */
  /** @namespace attr.ngfAsBackground */
  /** @namespace attr.ngfSize */
  /** @namespace attr.ngfNoObjectUrl */
  ngFileUpload.directive('ngfThumbnail', ['Upload', '$timeout', function (Upload, $timeout) {
    return {
      restrict: 'AE',
      link: function (scope, elem, attr) {
        const size = Upload.attrGetter('ngfSize', attr, scope)
        linkFileDirective(Upload, $timeout, scope, elem, attr, 'ngfThumbnail', size,
          Upload.attrGetter('ngfAsBackground', attr, scope))
      }
    }
  }])

  ngFileUpload.config(['$compileProvider', function ($compileProvider) {
    if ($compileProvider.imgSrcSanitizationWhitelist) $compileProvider.imgSrcSanitizationWhitelist(/^\s*(https?|ftp|mailto|tel|webcal|local|file|data|blob):/)
    if ($compileProvider.aHrefSanitizationWhitelist) $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|ftp|mailto|tel|webcal|local|file|data|blob):/)
  }])

  ngFileUpload.filter('ngfDataUrl', ['UploadDataUrl', '$sce', function (UploadDataUrl, $sce) {
    return function (file, disallowObjectUrl, trustedUrl) {
      if (angular.isString(file)) {
        return $sce.trustAsResourceUrl(file)
      }
      const src = file && ((disallowObjectUrl ? file.$ngfDataUrl : file.$ngfBlobUrl) || file.$ngfDataUrl)
      if (file && !src) {
        if (!file.$ngfDataUrlFilterInProgress && angular.isObject(file)) {
          file.$ngfDataUrlFilterInProgress = true
          UploadDataUrl.dataUrl(file, disallowObjectUrl)
        }
        return ''
      }
      if (file) delete file.$ngfDataUrlFilterInProgress
      return (file && src ? (trustedUrl ? $sce.trustAsResourceUrl(src) : src) : file) || ''
    }
  }])
})()

ngFileUpload.service('UploadValidate', ['UploadDataUrl', '$q', '$timeout', function (UploadDataUrl, $q, $timeout) {
  const upload = UploadDataUrl

  function globStringToRegex (str) {
    let regexp = ''; let excludes = []
    if (str.length > 2 && str[0] === '/' && str[str.length - 1] === '/') {
      regexp = str.substring(1, str.length - 1)
    } else {
      const split = str.split(',')
      if (split.length > 1) {
        for (let i = 0; i < split.length; i++) {
          const r = globStringToRegex(split[i])
          if (r.regexp) {
            regexp += '(' + r.regexp + ')'
            if (i < split.length - 1) {
              regexp += '|'
            }
          } else {
            excludes = excludes.concat(r.excludes)
          }
        }
      } else {
        if (str.indexOf('!') === 0) {
          excludes.push('^((?!' + globStringToRegex(str.substring(1)).regexp + ').)*$')
        } else {
          if (str.indexOf('.') === 0) {
            str = '*' + str
          }
          regexp = '^' + str.replace(new RegExp('[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\-]', 'g'), '\\$&') + '$'
          regexp = regexp.replace(/\\\*/g, '.*').replace(/\\\?/g, '.')
        }
      }
    }
    return { regexp, excludes }
  }

  upload.validatePattern = function (file, val) {
    if (!val) {
      return true
    }
    const pattern = globStringToRegex(val); let valid = true
    if (pattern.regexp && pattern.regexp.length) {
      const regexp = new RegExp(pattern.regexp, 'i')
      valid = (file.type != null && regexp.test(file.type)) ||
        (file.name != null && regexp.test(file.name))
    }
    let len = pattern.excludes.length
    while (len--) {
      const exclude = new RegExp(pattern.excludes[len], 'i')
      valid = valid && (file.type == null || exclude.test(file.type)) &&
        (file.name == null || exclude.test(file.name))
    }
    return valid
  }

  upload.ratioToFloat = function (val) {
    let r = val.toString(); const xIndex = r.search(/[x:]/i)
    if (xIndex > -1) {
      r = parseFloat(r.substring(0, xIndex)) / parseFloat(r.substring(xIndex + 1))
    } else {
      r = parseFloat(r)
    }
    return r
  }

  upload.registerModelChangeValidator = function (ngModel, attr, scope) {
    if (ngModel) {
      ngModel.$formatters.push(function (files) {
        if (ngModel.$dirty) {
          let filesArray = files
          if (files && !angular.isArray(files)) {
            filesArray = [files]
          }
          upload.validate(filesArray, 0, ngModel, attr, scope).then(function () {
            upload.applyModelValidation(ngModel, filesArray)
          })
        }
        return files
      })
    }
  }

  function markModelAsDirty (ngModel, files) {
    if (files != null && !ngModel.$dirty) {
      if (ngModel.$setDirty) {
        ngModel.$setDirty()
      } else {
        ngModel.$dirty = true
      }
    }
  }

  upload.applyModelValidation = function (ngModel, files) {
    markModelAsDirty(ngModel, files)
    angular.forEach(ngModel.$ngfValidations, function (validation) {
      ngModel.$setValidity(validation.name, validation.valid)
    })
  }

  upload.getValidationAttr = function (attr, scope, name, validationName, file) {
    const dName = 'ngf' + name[0].toUpperCase() + name.substr(1)
    let val = upload.attrGetter(dName, attr, scope, { $file: file })
    if (val == null) {
      val = upload.attrGetter('ngfValidate', attr, scope, { $file: file })
      if (val) {
        const split = (validationName || name).split('.')
        val = val[split[0]]
        if (split.length > 1) {
          val = val && val[split[1]]
        }
      }
    }
    return val
  }

  upload.validate = function (files, prevLength, ngModel, attr, scope) {
    ngModel = ngModel || {}
    ngModel.$ngfValidations = ngModel.$ngfValidations || []

    angular.forEach(ngModel.$ngfValidations, function (v) {
      v.valid = true
    })

    const attrGetter = function (name, params) {
      return upload.attrGetter(name, attr, scope, params)
    }

    const ignoredErrors = (upload.attrGetter('ngfIgnoreInvalid', attr, scope) || '').split(' ')
    let runAllValidation = upload.attrGetter('ngfRunAllValidations', attr, scope)

    if (files == null || files.length === 0) {
      return upload.emptyPromise({ validFiles: files, invalidFiles: [] })
    }

    files = files.length === undefined ? [files] : files.slice(0)
    const invalidFiles = []

    function validateSync (name, validationName, fn) {
      if (files) {
        let i = files.length; let valid = null
        while (i--) {
          const file = files[i]
          if (file) {
            const val = upload.getValidationAttr(attr, scope, name, validationName, file)
            if (val != null) {
              if (!fn(file, val, i)) {
                if (ignoredErrors.indexOf(name) === -1) {
                  file.$error = name;
                  (file.$errorMessages = (file.$errorMessages || {}))[name] = true
                  file.$errorParam = val
                  if (invalidFiles.indexOf(file) === -1) {
                    invalidFiles.push(file)
                  }
                  if (!runAllValidation) {
                    files.splice(i, 1)
                  }
                  valid = false
                } else {
                  files.splice(i, 1)
                }
              }
            }
          }
        }
        if (valid !== null) {
          ngModel.$ngfValidations.push({ name, valid })
        }
      }
    }

    validateSync('pattern', null, upload.validatePattern)
    validateSync('minSize', 'size.min', function (file, val) {
      return file.size + 0.1 >= upload.translateScalars(val)
    })
    validateSync('maxSize', 'size.max', function (file, val) {
      return file.size - 0.1 <= upload.translateScalars(val)
    })
    let totalSize = 0
    validateSync('maxTotalSize', null, function (file, val) {
      totalSize += file.size
      if (totalSize > upload.translateScalars(val)) {
        files.splice(0, files.length)
        return false
      }
      return true
    })

    validateSync('validateFn', null, function (file, r) {
      return r === true || r === null || r === ''
    })

    if (!files.length) {
      return upload.emptyPromise({ validFiles: [], invalidFiles })
    }

    function validateAsync (name, validationName, type, asyncFn, fn) {
      function resolveResult (defer, file, val) {
        function resolveInternal (fn) {
          if (fn()) {
            if (ignoredErrors.indexOf(name) === -1) {
              file.$error = name;
              (file.$errorMessages = (file.$errorMessages || {}))[name] = true
              file.$errorParam = val
              if (invalidFiles.indexOf(file) === -1) {
                invalidFiles.push(file)
              }
              if (!runAllValidation) {
                const i = files.indexOf(file)
                if (i > -1) files.splice(i, 1)
              }
              defer.resolve(false)
            } else {
              const j = files.indexOf(file)
              if (j > -1) files.splice(j, 1)
              defer.resolve(true)
            }
          } else {
            defer.resolve(true)
          }
        }

        if (val != null) {
          asyncFn(file, val).then(function (d) {
            resolveInternal(function () {
              return !fn(d, val)
            })
          }, function () {
            resolveInternal(function () {
              return attrGetter('ngfValidateForce', { $file: file })
            })
          })
        } else {
          defer.resolve(true)
        }
      }

      const promises = [upload.emptyPromise(true)]
      if (files) {
        files = files.length === undefined ? [files] : files
        angular.forEach(files, function (file) {
          const defer = $q.defer()
          promises.push(defer.promise)
          if (type && (file.type == null || file.type.search(type) !== 0)) {
            defer.resolve(true)
            return
          }
          if (name === 'dimensions' && upload.attrGetter('ngfDimensions', attr) != null) {
            upload.imageDimensions(file).then(function (d) {
              resolveResult(defer, file,
                attrGetter('ngfDimensions', { $file: file, $width: d.width, $height: d.height }))
            }, function () {
              defer.resolve(false)
            })
          } else if (name === 'duration' && upload.attrGetter('ngfDuration', attr) != null) {
            upload.mediaDuration(file).then(function (d) {
              resolveResult(defer, file,
                attrGetter('ngfDuration', { $file: file, $duration: d }))
            }, function () {
              defer.resolve(false)
            })
          } else {
            resolveResult(defer, file,
              upload.getValidationAttr(attr, scope, name, validationName, file))
          }
        })
      }
      const deffer = $q.defer()
      $q.all(promises).then(function (values) {
        let isValid = true
        for (let i = 0; i < values.length; i++) {
          if (!values[i]) {
            isValid = false
            break
          }
        }
        ngModel.$ngfValidations.push({ name, valid: isValid })
        deffer.resolve(isValid)
      })
      return deffer.promise
    }

    const deffer = $q.defer()
    const promises = []

    promises.push(validateAsync('maxHeight', 'height.max', /image/,
      this.imageDimensions, function (d, val) {
        return d.height <= val
      }))
    promises.push(validateAsync('minHeight', 'height.min', /image/,
      this.imageDimensions, function (d, val) {
        return d.height >= val
      }))
    promises.push(validateAsync('maxWidth', 'width.max', /image/,
      this.imageDimensions, function (d, val) {
        return d.width <= val
      }))
    promises.push(validateAsync('minWidth', 'width.min', /image/,
      this.imageDimensions, function (d, val) {
        return d.width >= val
      }))
    promises.push(validateAsync('dimensions', null, /image/,
      function (file, val) {
        return upload.emptyPromise(val)
      }, function (r) {
        return r
      }))
    promises.push(validateAsync('ratio', null, /image/,
      this.imageDimensions, function (d, val) {
        const split = val.toString().split(','); let valid = false
        for (let i = 0; i < split.length; i++) {
          if (Math.abs((d.width / d.height) - upload.ratioToFloat(split[i])) < 0.01) {
            valid = true
          }
        }
        return valid
      }))
    promises.push(validateAsync('maxRatio', 'ratio.max', /image/,
      this.imageDimensions, function (d, val) {
        return (d.width / d.height) - upload.ratioToFloat(val) < 0.0001
      }))
    promises.push(validateAsync('minRatio', 'ratio.min', /image/,
      this.imageDimensions, function (d, val) {
        return (d.width / d.height) - upload.ratioToFloat(val) > -0.0001
      }))
    promises.push(validateAsync('maxDuration', 'duration.max', /audio|video/,
      this.mediaDuration, function (d, val) {
        return d <= upload.translateScalars(val)
      }))
    promises.push(validateAsync('minDuration', 'duration.min', /audio|video/,
      this.mediaDuration, function (d, val) {
        return d >= upload.translateScalars(val)
      }))
    promises.push(validateAsync('duration', null, /audio|video/,
      function (file, val) {
        return upload.emptyPromise(val)
      }, function (r) {
        return r
      }))

    promises.push(validateAsync('validateAsyncFn', null, null,
      function (file, val) {
        return val
      }, function (r) {
        return r === true || r === null || r === ''
      }))

    $q.all(promises).then(function () {
      if (runAllValidation) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (file.$error) {
            files.splice(i--, 1)
          }
        }
      }

      runAllValidation = false
      validateSync('maxFiles', null, function (file, val, i) {
        return prevLength + i < val
      })

      deffer.resolve({ validFiles: files, invalidFiles })
    })
    return deffer.promise
  }

  upload.imageDimensions = function (file) {
    if (file.$ngfWidth && file.$ngfHeight) {
      const d = $q.defer()
      $timeout(function () {
        d.resolve({ width: file.$ngfWidth, height: file.$ngfHeight })
      })
      return d.promise
    }
    if (file.$ngfDimensionPromise) return file.$ngfDimensionPromise

    const deferred = $q.defer()
    $timeout(function () {
      if (file.type.indexOf('image') !== 0) {
        deferred.reject('not image')
        return
      }
      upload.dataUrl(file).then(function (dataUrl) {
        const img = angular.element('<img>').attr('src', dataUrl)
          .css('visibility', 'hidden').css('position', 'fixed')
          .css('max-width', 'none !important').css('max-height', 'none !important')

        function success () {
          const width = img[0].naturalWidth || img[0].clientWidth
          const height = img[0].naturalHeight || img[0].clientHeight
          img.remove()
          file.$ngfWidth = width
          file.$ngfHeight = height
          deferred.resolve({ width, height })
        }

        function error () {
          img.remove()
          deferred.reject('load error')
        }

        img.on('load', success)
        img.on('error', error)

        let secondsCounter = 0
        function checkLoadErrorInCaseOfNoCallback () {
          $timeout(function () {
            if (img[0].parentNode) {
              if (img[0].clientWidth) {
                success()
              } else if (secondsCounter++ > 10) {
                error()
              } else {
                checkLoadErrorInCaseOfNoCallback()
              }
            }
          }, 1000)
        }

        checkLoadErrorInCaseOfNoCallback()

        angular.element(document.getElementsByTagName('body')[0]).append(img)
      }, function () {
        deferred.reject('load error')
      })
    })

    file.$ngfDimensionPromise = deferred.promise
    file.$ngfDimensionPromise.finally(function () {
      delete file.$ngfDimensionPromise
    })
    return file.$ngfDimensionPromise
  }

  upload.mediaDuration = function (file) {
    if (file.$ngfDuration) {
      const d = $q.defer()
      $timeout(function () {
        d.resolve(file.$ngfDuration)
      })
      return d.promise
    }
    if (file.$ngfDurationPromise) return file.$ngfDurationPromise

    const deferred = $q.defer()
    $timeout(function () {
      if (file.type.indexOf('audio') !== 0 && file.type.indexOf('video') !== 0) {
        deferred.reject('not media')
        return
      }
      upload.dataUrl(file).then(function (dataUrl) {
        const el = angular.element(file.type.indexOf('audio') === 0 ? '<audio>' : '<video>')
          .attr('src', dataUrl).css('visibility', 'none').css('position', 'fixed')

        function success () {
          const duration = el[0].duration
          file.$ngfDuration = duration
          el.remove()
          deferred.resolve(duration)
        }

        function error () {
          el.remove()
          deferred.reject('load error')
        }

        el.on('loadedmetadata', success)
        el.on('error', error)
        const count = 0

        function checkLoadError () {
          $timeout(function () {
            if (el[0].parentNode) {
              if (el[0].duration) {
                success()
              } else if (count > 10) {
                error()
              } else {
                checkLoadError()
              }
            }
          }, 1000)
        }

        checkLoadError()

        angular.element(document.body).append(el)
      }, function () {
        deferred.reject('load error')
      })
    })

    file.$ngfDurationPromise = deferred.promise
    file.$ngfDurationPromise.finally(function () {
      delete file.$ngfDurationPromise
    })
    return file.$ngfDurationPromise
  }
  return upload
}
])

ngFileUpload.service('UploadResize', ['UploadValidate', '$q', function (UploadValidate, $q) {
  const upload = UploadValidate

  /**
   * Conserve aspect ratio of the original region. Useful when shrinking/enlarging
   * images to fit into a certain area.
   * Source:  http://stackoverflow.com/a/14731922
   *
   * @param {Number} srcWidth Source area width
   * @param {Number} srcHeight Source area height
   * @param {Number} maxWidth Nestable area maximum available width
   * @param {Number} maxHeight Nestable area maximum available height
   * @return {Object} { width, height }
   */
  const calculateAspectRatioFit = function (srcWidth, srcHeight, maxWidth, maxHeight, centerCrop) {
    const ratio = centerCrop
      ? Math.max(maxWidth / srcWidth, maxHeight / srcHeight)
      : Math.min(maxWidth / srcWidth, maxHeight / srcHeight)
    return {
      width: srcWidth * ratio,
      height: srcHeight * ratio,
      marginX: srcWidth * ratio - maxWidth,
      marginY: srcHeight * ratio - maxHeight
    }
  }

  // Extracted from https://github.com/romelgomez/angular-firebase-image-upload/blob/master/app/scripts/fileUpload.js#L89
  const resize = function (imagen, width, height, quality, type, ratio, centerCrop, resizeIf) {
    const deferred = $q.defer()
    const canvasElement = document.createElement('canvas')
    const imageElement = document.createElement('img')
    imageElement.setAttribute('style', 'visibility:hidden;position:fixed;z-index:-100000')
    document.body.appendChild(imageElement)

    imageElement.onload = function () {
      const imgWidth = imageElement.width; const imgHeight = imageElement.height
      imageElement.parentNode.removeChild(imageElement)
      if (resizeIf != null && resizeIf(imgWidth, imgHeight) === false) {
        deferred.reject('resizeIf')
        return
      }
      try {
        if (ratio) {
          const ratioFloat = upload.ratioToFloat(ratio)
          const imgRatio = imgWidth / imgHeight
          if (imgRatio < ratioFloat) {
            width = imgWidth
            height = width / ratioFloat
          } else {
            height = imgHeight
            width = height * ratioFloat
          }
        }
        if (!width) {
          width = imgWidth
        }
        if (!height) {
          height = imgHeight
        }
        const dimensions = calculateAspectRatioFit(imgWidth, imgHeight, width, height, centerCrop)
        canvasElement.width = Math.min(dimensions.width, width)
        canvasElement.height = Math.min(dimensions.height, height)
        const context = canvasElement.getContext('2d')
        context.drawImage(imageElement,
          Math.min(0, -dimensions.marginX / 2), Math.min(0, -dimensions.marginY / 2),
          dimensions.width, dimensions.height)
        deferred.resolve(canvasElement.toDataURL(type || 'image/WebP', quality || 0.934))
      } catch (e) {
        deferred.reject(e)
      }
    }
    imageElement.onerror = function () {
      imageElement.parentNode.removeChild(imageElement)
      deferred.reject()
    }
    imageElement.src = imagen
    return deferred.promise
  }

  upload.dataUrltoBlob = function (dataurl, name, origSize) {
    const arr = dataurl.split(','); const mime = arr[0].match(/:(.*?);/)[1]
    const bstr = atob(arr[1]); let n = bstr.length; const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    const blob = new window.Blob([u8arr], { type: mime })
    blob.name = name
    blob.$ngfOrigSize = origSize
    return blob
  }

  upload.isResizeSupported = function () {
    const elem = document.createElement('canvas')
    return window.atob && elem.getContext && elem.getContext('2d') && window.Blob
  }

  if (upload.isResizeSupported()) {
    // add name getter to the blob constructor prototype
    Object.defineProperty(window.Blob.prototype, 'name', {
      get: function () {
        return this.$ngfName
      },
      set: function (v) {
        this.$ngfName = v
      },
      configurable: true
    })
  }

  upload.resize = function (file, options) {
    if (file.type.indexOf('image') !== 0) return upload.emptyPromise(file)

    const deferred = $q.defer()
    upload.dataUrl(file, true).then(function (url) {
      resize(url, options.width, options.height, options.quality, options.type || file.type,
        options.ratio, options.centerCrop, options.resizeIf)
        .then(function (dataUrl) {
          if (file.type === 'image/jpeg' && options.restoreExif !== false) {
            try {
              dataUrl = upload.restoreExif(url, dataUrl)
            } catch (e) {
              setTimeout(function () { throw e }, 1)
            }
          }
          try {
            const blob = upload.dataUrltoBlob(dataUrl, file.name, file.size)
            deferred.resolve(blob)
          } catch (e) {
            deferred.reject(e)
          }
        }, function (r) {
          if (r === 'resizeIf') {
            deferred.resolve(file)
          }
          deferred.reject(r)
        })
    }, function (e) {
      deferred.reject(e)
    })
    return deferred.promise
  }

  return upload
}]);

(function () {
  ngFileUpload.directive('ngfDrop', ['$parse', '$timeout', '$window', 'Upload', '$http', '$q',
    function ($parse, $timeout, $window, Upload, $http, $q) {
      return {
        restrict: 'AEC',
        require: '?ngModel',
        link: function (scope, elem, attr, ngModel) {
          linkDrop(scope, elem, attr, ngModel, $parse, $timeout, $window, Upload, $http, $q)
        }
      }
    }])

  ngFileUpload.directive('ngfNoFileDrop', function () {
    return function (scope, elem) {
      if (dropAvailable()) elem.css('display', 'none')
    }
  })

  ngFileUpload.directive('ngfDropAvailable', ['$parse', '$timeout', 'Upload', function ($parse, $timeout, Upload) {
    return function (scope, elem, attr) {
      if (dropAvailable()) {
        const model = $parse(Upload.attrGetter('ngfDropAvailable', attr))
        $timeout(function () {
          model(scope)
          if (model.assign) {
            model.assign(scope, true)
          }
        })
      }
    }
  }])

  function linkDrop (scope, elem, attr, ngModel, $parse, $timeout, $window, upload, $http, $q) {
    const available = dropAvailable()

    const attrGetter = function (name, scope, params) {
      return upload.attrGetter(name, attr, scope, params)
    }

    if (attrGetter('dropAvailable')) {
      $timeout(function () {
        if (scope[attrGetter('dropAvailable')]) {
          scope[attrGetter('dropAvailable')].value = available
        } else {
          scope[attrGetter('dropAvailable')] = available
        }
      })
    }
    if (!available) {
      if (attrGetter('ngfHideOnDropNotAvailable', scope) === true) {
        elem.css('display', 'none')
      }
      return
    }

    function isDisabled () {
      return elem.attr('disabled') || attrGetter('ngfDropDisabled', scope)
    }

    if (attrGetter('ngfSelect') == null) {
      upload.registerModelChangeValidator(ngModel, attr, scope)
    }

    let leaveTimeout = null
    const stopPropagation = $parse(attrGetter('ngfStopPropagation'))
    let dragOverDelay = 1
    let actualDragOverClass

    elem[0].addEventListener('dragover', function (evt) {
      if (isDisabled() || !upload.shouldUpdateOn('drop', attr, scope)) return
      evt.preventDefault()
      if (stopPropagation(scope)) evt.stopPropagation()
      // handling dragover events from the Chrome download bar
      if (navigator.userAgent.indexOf('Chrome') > -1) {
        const b = evt.dataTransfer.effectAllowed
        evt.dataTransfer.dropEffect = (b === 'move' || b === 'linkMove') ? 'move' : 'copy'
      }
      $timeout.cancel(leaveTimeout)
      if (!actualDragOverClass) {
        actualDragOverClass = 'C'
        calculateDragOverClass(scope, attr, evt, function (clazz) {
          actualDragOverClass = clazz
          elem.addClass(actualDragOverClass)
          attrGetter('ngfDrag', scope, { $isDragging: true, $class: actualDragOverClass, $event: evt })
        })
      }
    }, false)
    elem[0].addEventListener('dragenter', function (evt) {
      if (isDisabled() || !upload.shouldUpdateOn('drop', attr, scope)) return
      evt.preventDefault()
      if (stopPropagation(scope)) evt.stopPropagation()
    }, false)
    elem[0].addEventListener('dragleave', function (evt) {
      if (isDisabled() || !upload.shouldUpdateOn('drop', attr, scope)) return
      evt.preventDefault()
      if (stopPropagation(scope)) evt.stopPropagation()
      leaveTimeout = $timeout(function () {
        if (actualDragOverClass) elem.removeClass(actualDragOverClass)
        actualDragOverClass = null
        attrGetter('ngfDrag', scope, { $isDragging: false, $event: evt })
      }, dragOverDelay || 100)
    }, false)
    elem[0].addEventListener('drop', function (evt) {
      if (isDisabled() || !upload.shouldUpdateOn('drop', attr, scope)) return
      evt.preventDefault()
      if (stopPropagation(scope)) evt.stopPropagation()
      if (actualDragOverClass) elem.removeClass(actualDragOverClass)
      actualDragOverClass = null
      extractFilesAndUpdateModel(evt.dataTransfer, evt, 'dropUrl')
    }, false)
    elem[0].addEventListener('paste', function (evt) {
      if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1 &&
        attrGetter('ngfEnableFirefoxPaste', scope)) {
        evt.preventDefault()
      }
      if (isDisabled() || !upload.shouldUpdateOn('paste', attr, scope)) return
      extractFilesAndUpdateModel(evt.clipboardData || evt.originalEvent.clipboardData, evt, 'pasteUrl')
    }, false)

    if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1 &&
      attrGetter('ngfEnableFirefoxPaste', scope)) {
      elem.attr('contenteditable', true)
      elem.on('keypress', function (e) {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault()
        }
      })
    }

    function extractFilesAndUpdateModel (source, evt, updateOnType) {
      if (!source) return
      // html needs to be calculated on the same process otherwise the data will be wiped
      // after promise resolve or setTimeout.
      let html
      try {
        html = source && source.getData && source.getData('text/html')
      } catch (e) { /* Fix IE11 that throw error calling getData */
      }
      extractFiles(source.items, source.files, attrGetter('ngfAllowDir', scope) !== false,
        attrGetter('multiple') || attrGetter('ngfMultiple', scope)).then(function (files) {
        if (files.length) {
          updateModel(files, evt)
        } else {
          extractFilesFromHtml(updateOnType, html).then(function (files) {
            updateModel(files, evt)
          })
        }
      })
    }

    function updateModel (files, evt) {
      upload.updateModel(ngModel, attr, scope, attrGetter('ngfChange') || attrGetter('ngfDrop'), files, evt)
    }

    function extractFilesFromHtml (updateOn, html) {
      if (!upload.shouldUpdateOn(updateOn, attr, scope) || typeof html !== 'string') return upload.rejectPromise([])
      const urls = []
      html.replace(/<(img src|img [^>]* src) *=\"([^\"]*)\"/gi, function (m, n, src) {
        urls.push(src)
      })
      const promises = []; const files = []
      if (urls.length) {
        angular.forEach(urls, function (url) {
          promises.push(upload.urlToBlob(url).then(function (blob) {
            files.push(blob)
          }))
        })
        const defer = $q.defer()
        $q.all(promises).then(function () {
          defer.resolve(files)
        }, function (e) {
          defer.reject(e)
        })
        return defer.promise
      }
      return upload.emptyPromise()
    }

    function calculateDragOverClass (scope, attr, evt, callback) {
      const obj = attrGetter('ngfDragOverClass', scope, { $event: evt }); let dClass = 'dragover'
      if (angular.isString(obj)) {
        dClass = obj
      } else if (obj) {
        if (obj.delay) dragOverDelay = obj.delay
        if (obj.accept || obj.reject) {
          const items = evt.dataTransfer.items
          if (items == null || !items.length) {
            dClass = obj.accept
          } else {
            const pattern = obj.pattern || attrGetter('ngfPattern', scope, { $event: evt })
            let len = items.length
            while (len--) {
              if (!upload.validatePattern(items[len], pattern)) {
                dClass = obj.reject
                break
              } else {
                dClass = obj.accept
              }
            }
          }
        }
      }
      callback(dClass)
    }

    function extractFiles (items, fileList, allowDir, multiple) {
      let maxFiles = upload.getValidationAttr(attr, scope, 'maxFiles')
      if (maxFiles == null) {
        maxFiles = Number.MAX_VALUE
      }
      let maxTotalSize = upload.getValidationAttr(attr, scope, 'maxTotalSize')
      if (maxTotalSize == null) {
        maxTotalSize = Number.MAX_VALUE
      }
      const includeDir = attrGetter('ngfIncludeDir', scope)
      const files = []; let totalSize = 0

      function traverseFileTree (entry, path) {
        const defer = $q.defer()
        if (entry != null) {
          if (entry.isDirectory) {
            const promises = [upload.emptyPromise()]
            if (includeDir) {
              const file = { type: 'directory' }
              file.name = file.path = (path || '') + entry.name
              files.push(file)
            }
            const dirReader = entry.createReader()
            let entries = []
            var readEntries = function () {
              dirReader.readEntries(function (results) {
                try {
                  if (!results.length) {
                    angular.forEach(entries.slice(0), function (e) {
                      if (files.length <= maxFiles && totalSize <= maxTotalSize) {
                        promises.push(traverseFileTree(e, (path || '') + entry.name + '/'))
                      }
                    })
                    $q.all(promises).then(function () {
                      defer.resolve()
                    }, function (e) {
                      defer.reject(e)
                    })
                  } else {
                    entries = entries.concat(Array.prototype.slice.call(results || [], 0))
                    readEntries()
                  }
                } catch (e) {
                  defer.reject(e)
                }
              }, function (e) {
                defer.reject(e)
              })
            }
            readEntries()
          } else {
            entry.file(function (file) {
              try {
                file.path = (path || '') + file.name
                if (includeDir) {
                  file = upload.rename(file, file.path)
                }
                files.push(file)
                totalSize += file.size
                defer.resolve()
              } catch (e) {
                defer.reject(e)
              }
            }, function (e) {
              defer.reject(e)
            })
          }
        }
        return defer.promise
      }

      const promises = [upload.emptyPromise()]

      if (items && items.length > 0 && $window.location.protocol !== 'file:') {
        for (let i = 0; i < items.length; i++) {
          if (items[i].webkitGetAsEntry && items[i].webkitGetAsEntry() && items[i].webkitGetAsEntry().isDirectory) {
            const entry = items[i].webkitGetAsEntry()
            if (entry.isDirectory && !allowDir) {
              continue
            }
            if (entry != null) {
              promises.push(traverseFileTree(entry))
            }
          } else {
            const f = items[i].getAsFile()
            if (f != null) {
              files.push(f)
              totalSize += f.size
            }
          }
          if (files.length > maxFiles || totalSize > maxTotalSize ||
            (!multiple && files.length > 0)) break
        }
      } else {
        if (fileList != null) {
          for (let j = 0; j < fileList.length; j++) {
            const file = fileList.item(j)
            if (file.type || file.size > 0) {
              files.push(file)
              totalSize += file.size
            }
            if (files.length > maxFiles || totalSize > maxTotalSize ||
              (!multiple && files.length > 0)) break
          }
        }
      }

      const defer = $q.defer()
      $q.all(promises).then(function () {
        if (!multiple && !includeDir && files.length) {
          let i = 0
          while (files[i] && files[i].type === 'directory') i++
          defer.resolve([files[i]])
        } else {
          defer.resolve(files)
        }
      }, function (e) {
        defer.reject(e)
      })

      return defer.promise
    }
  }

  function dropAvailable () {
    const div = document.createElement('div')
    return ('draggable' in div) && ('ondrop' in div) && !/Edge\/12./i.test(navigator.userAgent)
  }
})()

// customized version of https://github.com/exif-js/exif-js
ngFileUpload.service('UploadExif', ['UploadResize', '$q', function (UploadResize, $q) {
  const upload = UploadResize

  upload.isExifSupported = function () {
    return window.FileReader && new FileReader().readAsArrayBuffer && upload.isResizeSupported()
  }

  function applyTransform (ctx, orientation, width, height) {
    switch (orientation) {
      case 2:
        return ctx.transform(-1, 0, 0, 1, width, 0)
      case 3:
        return ctx.transform(-1, 0, 0, -1, width, height)
      case 4:
        return ctx.transform(1, 0, 0, -1, 0, height)
      case 5:
        return ctx.transform(0, 1, 1, 0, 0, 0)
      case 6:
        return ctx.transform(0, 1, -1, 0, height, 0)
      case 7:
        return ctx.transform(0, -1, -1, 0, height, width)
      case 8:
        return ctx.transform(0, -1, 1, 0, 0, width)
    }
  }

  upload.readOrientation = function (file) {
    const defer = $q.defer()
    const reader = new FileReader()
    const slicedFile = file.slice ? file.slice(0, 64 * 1024) : file
    reader.readAsArrayBuffer(slicedFile)
    reader.onerror = function (e) {
      return defer.reject(e)
    }
    reader.onload = function (e) {
      const result = { orientation: 1 }
      const view = new DataView(this.result)
      if (view.getUint16(0, false) !== 0xFFD8) return defer.resolve(result)

      const length = view.byteLength
      let offset = 2
      while (offset < length) {
        const marker = view.getUint16(offset, false)
        offset += 2
        if (marker === 0xFFE1) {
          if (view.getUint32(offset += 2, false) !== 0x45786966) return defer.resolve(result)

          const little = view.getUint16(offset += 6, false) === 0x4949
          offset += view.getUint32(offset + 4, little)
          const tags = view.getUint16(offset, little)
          offset += 2
          for (let i = 0; i < tags; i++) {
            if (view.getUint16(offset + (i * 12), little) === 0x0112) {
              const orientation = view.getUint16(offset + (i * 12) + 8, little)
              if (orientation >= 2 && orientation <= 8) {
                view.setUint16(offset + (i * 12) + 8, 1, little)
                result.fixedArrayBuffer = e.target.result
              }
              result.orientation = orientation
              return defer.resolve(result)
            }
          }
        } else if ((marker & 0xFF00) !== 0xFF00) break
        else offset += view.getUint16(offset, false)
      }
      return defer.resolve(result)
    }
    return defer.promise
  }

  function arrayBufferToBase64 (buffer) {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }

  upload.applyExifRotation = function (file) {
    if (file.type.indexOf('image/jpeg') !== 0) {
      return upload.emptyPromise(file)
    }

    const deferred = $q.defer()
    upload.readOrientation(file).then(function (result) {
      if (result.orientation < 2 || result.orientation > 8) {
        return deferred.resolve(file)
      }
      upload.dataUrl(file, true).then(function (url) {
        const canvas = document.createElement('canvas')
        const img = document.createElement('img')

        img.onload = function () {
          try {
            canvas.width = result.orientation > 4 ? img.height : img.width
            canvas.height = result.orientation > 4 ? img.width : img.height
            const ctx = canvas.getContext('2d')
            applyTransform(ctx, result.orientation, img.width, img.height)
            ctx.drawImage(img, 0, 0)
            let dataUrl = canvas.toDataURL(file.type || 'image/WebP', 0.934)
            dataUrl = upload.restoreExif(arrayBufferToBase64(result.fixedArrayBuffer), dataUrl)
            const blob = upload.dataUrltoBlob(dataUrl, file.name)
            deferred.resolve(blob)
          } catch (e) {
            return deferred.reject(e)
          }
        }
        img.onerror = function () {
          deferred.reject()
        }
        img.src = url
      }, function (e) {
        deferred.reject(e)
      })
    }, function (e) {
      deferred.reject(e)
    })
    return deferred.promise
  }

  upload.restoreExif = function (orig, resized) {
    const ExifRestorer = {}

    ExifRestorer.KEY_STR = 'ABCDEFGHIJKLMNOP' +
      'QRSTUVWXYZabcdef' +
      'ghijklmnopqrstuv' +
      'wxyz0123456789+/' +
      '='

    ExifRestorer.encode64 = function (input) {
      let output = ''
      let chr1; let chr2; let chr3 = ''
      let enc1; let enc2; let enc3; let enc4 = ''
      let i = 0

      do {
        chr1 = input[i++]
        chr2 = input[i++]
        chr3 = input[i++]

        enc1 = chr1 >> 2
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4)
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6)
        enc4 = chr3 & 63

        if (isNaN(chr2)) {
          enc3 = enc4 = 64
        } else if (isNaN(chr3)) {
          enc4 = 64
        }

        output = output +
          this.KEY_STR.charAt(enc1) +
          this.KEY_STR.charAt(enc2) +
          this.KEY_STR.charAt(enc3) +
          this.KEY_STR.charAt(enc4)
        chr1 = chr2 = chr3 = ''
        enc1 = enc2 = enc3 = enc4 = ''
      } while (i < input.length)

      return output
    }

    ExifRestorer.restore = function (origFileBase64, resizedFileBase64) {
      if (origFileBase64.match('data:image/jpeg;base64,')) {
        origFileBase64 = origFileBase64.replace('data:image/jpeg;base64,', '')
      }

      const rawImage = this.decode64(origFileBase64)
      const segments = this.slice2Segments(rawImage)

      const image = this.exifManipulation(resizedFileBase64, segments)

      return 'data:image/jpeg;base64,' + this.encode64(image)
    }

    ExifRestorer.exifManipulation = function (resizedFileBase64, segments) {
      const exifArray = this.getExifArray(segments)
      const newImageArray = this.insertExif(resizedFileBase64, exifArray)
      return new Uint8Array(newImageArray)
    }

    ExifRestorer.getExifArray = function (segments) {
      let seg
      for (let x = 0; x < segments.length; x++) {
        seg = segments[x]
        if (seg[0] === 255 & seg[1] === 225) // (ff e1)
        {
          return seg
        }
      }
      return []
    }

    ExifRestorer.insertExif = function (resizedFileBase64, exifArray) {
      const imageData = resizedFileBase64.replace('data:image/jpeg;base64,', '')
      const buf = this.decode64(imageData)
      const separatePoint = buf.indexOf(255, 3)
      const mae = buf.slice(0, separatePoint)
      const ato = buf.slice(separatePoint)
      let array = mae

      array = array.concat(exifArray)
      array = array.concat(ato)
      return array
    }

    ExifRestorer.slice2Segments = function (rawImageArray) {
      let head = 0
      const segments = []

      while (1) {
        if (rawImageArray[head] === 255 & rawImageArray[head + 1] === 218) {
          break
        }
        if (rawImageArray[head] === 255 & rawImageArray[head + 1] === 216) {
          head += 2
        } else {
          const length = rawImageArray[head + 2] * 256 + rawImageArray[head + 3]
          const endPoint = head + length + 2
          const seg = rawImageArray.slice(head, endPoint)
          segments.push(seg)
          head = endPoint
        }
        if (head > rawImageArray.length) {
          break
        }
      }

      return segments
    }

    ExifRestorer.decode64 = function (input) {
      let chr1; let chr2; let chr3 = ''
      let enc1; let enc2; let enc3; let enc4 = ''
      let i = 0
      const buf = []

      // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
      const base64test = /[^A-Za-z0-9\+\/\=]/g
      if (base64test.exec(input)) {
        console.log('There were invalid base64 characters in the input text.\n' +
          'Valid base64 characters are A-Z, a-z, 0-9, ' + ', ' / ',and "="\n' +
          'Expect errors in decoding.')
      }
      input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '')

      do {
        enc1 = this.KEY_STR.indexOf(input.charAt(i++))
        enc2 = this.KEY_STR.indexOf(input.charAt(i++))
        enc3 = this.KEY_STR.indexOf(input.charAt(i++))
        enc4 = this.KEY_STR.indexOf(input.charAt(i++))

        chr1 = (enc1 << 2) | (enc2 >> 4)
        chr2 = ((enc2 & 15) << 4) | (enc3 >> 2)
        chr3 = ((enc3 & 3) << 6) | enc4

        buf.push(chr1)

        if (enc3 !== 64) {
          buf.push(chr2)
        }
        if (enc4 !== 64) {
          buf.push(chr3)
        }

        chr1 = chr2 = chr3 = ''
        enc1 = enc2 = enc3 = enc4 = ''
      } while (i < input.length)

      return buf
    }

    return ExifRestorer.restore(orig, resized) // <= EXIF
  }

  return upload
}])
