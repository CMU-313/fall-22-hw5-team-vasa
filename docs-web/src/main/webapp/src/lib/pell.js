(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? factory(exports)
    : typeof define === 'function' && define.amd
      ? define(['exports'], factory)
      : (factory((global.pell = {})))
}(this, function (exports) {
  'use strict'

  const _extends = Object.assign || function (target) { for (let i = 1; i < arguments.length; i++) { const source = arguments[i]; for (const key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key] } } } return target }

  const defaultParagraphSeparatorString = 'defaultParagraphSeparator'
  const formatBlock = 'formatBlock'
  const addEventListener = function addEventListener (parent, type, listener) {
    return parent.addEventListener(type, listener)
  }
  const appendChild = function appendChild (parent, child) {
    return parent.appendChild(child)
  }
  const createElement = function createElement (tag) {
    return document.createElement(tag)
  }
  const queryCommandState = function queryCommandState (command) {
    return document.queryCommandState(command)
  }
  const queryCommandValue = function queryCommandValue (command) {
    return document.queryCommandValue(command)
  }

  const exec = function exec (command) {
    const value = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null
    return document.execCommand(command, false, value)
  }

  const defaultActions = {
    bold: {
      icon: '<b>B</b>',
      title: 'Bold',
      state: function state () {
        return queryCommandState('bold')
      },
      result: function result () {
        return exec('bold')
      }
    },
    italic: {
      icon: '<i>I</i>',
      title: 'Italic',
      state: function state () {
        return queryCommandState('italic')
      },
      result: function result () {
        return exec('italic')
      }
    },
    underline: {
      icon: '<u>U</u>',
      title: 'Underline',
      state: function state () {
        return queryCommandState('underline')
      },
      result: function result () {
        return exec('underline')
      }
    },
    strikethrough: {
      icon: '<strike>S</strike>',
      title: 'Strike-through',
      state: function state () {
        return queryCommandState('strikeThrough')
      },
      result: function result () {
        return exec('strikeThrough')
      }
    },
    heading1: {
      icon: '<b>H<sub>1</sub></b>',
      title: 'Heading 1',
      result: function result () {
        return exec(formatBlock, '<h1>')
      }
    },
    heading2: {
      icon: '<b>H<sub>2</sub></b>',
      title: 'Heading 2',
      result: function result () {
        return exec(formatBlock, '<h2>')
      }
    },
    paragraph: {
      icon: '&#182;',
      title: 'Paragraph',
      result: function result () {
        return exec(formatBlock, '<p>')
      }
    },
    quote: {
      icon: '&#8220; &#8221;',
      title: 'Quote',
      result: function result () {
        return exec(formatBlock, '<blockquote>')
      }
    },
    olist: {
      icon: '&#35;',
      title: 'Ordered List',
      result: function result () {
        return exec('insertOrderedList')
      }
    },
    ulist: {
      icon: '&#8226;',
      title: 'Unordered List',
      result: function result () {
        return exec('insertUnorderedList')
      }
    },
    code: {
      icon: '&lt;/&gt;',
      title: 'Code',
      result: function result () {
        return exec(formatBlock, '<pre>')
      }
    },
    line: {
      icon: '&#8213;',
      title: 'Horizontal Line',
      result: function result () {
        return exec('insertHorizontalRule')
      }
    },
    link: {
      icon: '&#128279;',
      title: 'Link',
      result: function result () {
        const url = window.prompt('Enter the link URL')
        if (url) exec('createLink', url)
      }
    },
    image: {
      icon: '&#128247;',
      title: 'Image',
      result: function result () {
        const url = window.prompt('Enter the image URL')
        if (url) exec('insertImage', url)
      }
    }
  }

  const defaultClasses = {
    actionbar: 'pell-actionbar',
    button: 'pell-button',
    content: 'pell-content',
    selected: 'pell-button-selected'
  }

  const init = function init (settings) {
    const actions = settings.actions
      ? settings.actions.map(function (action) {
        if (typeof action === 'string') return defaultActions[action]; else if (defaultActions[action.name]) return _extends({}, defaultActions[action.name], action)
        return action
      })
      : Object.keys(defaultActions).map(function (action) {
        return defaultActions[action]
      })

    const classes = _extends({}, defaultClasses, settings.classes)

    const defaultParagraphSeparator = settings[defaultParagraphSeparatorString] || 'div'

    const actionbar = createElement('div')
    actionbar.className = classes.actionbar
    appendChild(settings.element, actionbar)

    const content = settings.element.content = createElement('div')
    content.contentEditable = true
    content.className = classes.content
    content.oninput = function (_ref) {
      const firstChild = _ref.target.firstChild

      if (firstChild && firstChild.nodeType === 3) exec(formatBlock, '<' + defaultParagraphSeparator + '>'); else if (content.innerHTML === '<br>') content.innerHTML = ''
      settings.onChange(content.innerHTML)
    }
    content.onkeydown = function (event) {
      if (event.key === 'Tab') {
        event.preventDefault()
      } else if (event.key === 'Enter' && queryCommandValue(formatBlock) === 'blockquote') {
        setTimeout(function () {
          return exec(formatBlock, '<' + defaultParagraphSeparator + '>')
        }, 0)
      }
    }
    appendChild(settings.element, content)

    actions.forEach(function (action) {
      const button = createElement('button')
      button.className = classes.button
      button.innerHTML = action.icon
      button.title = action.title
      button.setAttribute('type', 'button')
      button.onclick = function () {
        return action.result() && content.focus()
      }

      if (action.state) {
        const handler = function handler () {
          return button.classList[action.state() ? 'add' : 'remove'](classes.selected)
        }
        addEventListener(content, 'keyup', handler)
        addEventListener(content, 'mouseup', handler)
        addEventListener(button, 'click', handler)
      }

      appendChild(actionbar, button)
    })

    if (settings.styleWithCSS) exec('styleWithCSS')
    exec(defaultParagraphSeparatorString, defaultParagraphSeparator)

    return settings.element
  }

  const pell = { exec, init }

  exports.exec = exec
  exports.init = init
  exports.default = pell

  Object.defineProperty(exports, '__esModule', { value: true })
}))
