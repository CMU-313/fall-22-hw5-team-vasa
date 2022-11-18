'use strict'

/**
 * Password reset controller.
 */
angular.module('docs').controller('PasswordReset', function ($scope, Restangular, $state, $stateParams, $translate, $dialog) {
  $scope.submit = function () {
    Restangular.one('user').post('password_reset', {
      key: $stateParams.key,
      password: $scope.password
    }).then(function () {
      $state.go('login')
    }, function () {
      const title = $translate.instant('passwordreset.error_title')
      const msg = $translate.instant('passwordreset.error_message')
      const btns = [{ result: 'ok', label: $translate.instant('ok'), cssClass: 'btn-primary' }]
      $dialog.messageBox(title, msg, btns)
    })
  }
})
