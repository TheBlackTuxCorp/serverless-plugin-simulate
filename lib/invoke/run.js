'use strict'

const BbPromise = require('bluebird')
const spawn = require('child_process').spawn

const ENV_VARS = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCOUNT_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_LAMBDA_FUNCTION_VERSION',
  'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
  'AWS_LAMBDA_FUNCTION_TIMEOUT',
  'AWS_LAMBDA_FUNCTION_HANDLER',
  'AWS_LAMBDA_EVENT_BODY'
]

const ENV_ARGS = ENV_VARS.reduce((accum, x) => accum.concat(['-e', x]), [])

const log = (msg) => console.log(msg) // eslint-disable-line no-console

const basename = (str) => {
  var base = new String(str).substring(str.lastIndexOf('/') + 1)
  if (base.lastIndexOf('.') != -1) {
    base = base.substring(0, base.lastIndexOf('.'))
  }
  return base.substring(0, 12)
}

const getContainer = () => {
  log('get container id')
  let containerId = ''

  return new BbPromise((resolve, reject) => {
    const dockerInfo = spawn('cat', ['/proc/1/cpuset'])

    dockerInfo.stdout.on('data', (data) => {
      containerId = basename(data)
      console.log(`container_id: ${containerId}`)
    })

    dockerInfo.on('close', (code) => {
      resolve(containerId)
    })
  })
}

const getArgs = (opt, parentContainer) => {
  log('build arguments')
  return new BbPromise((resolve, reject) => {
    const options = opt || {}
    const dockerImage = options.dockerImage || 'lambci/lambda'
    const handler = options.handler || 'index.handler'
    const event = options.event || {}
    const taskDir = options.taskDir == null ? process.cwd() : options.taskDir
    const networkArg = process.env.DOCKER || false
    const cleanUp = options.cleanUp == null ? true : options.cleanUp
    const addEnvVars = options.addEnvVars || false
    const dockerArgs = options.dockerArgs || []
    const spawnOptions = options.spawnOptions || { encoding: 'utf8' }

    const args = ['run']
      .concat(parentContainer ? ['--volumes-from', `${parentContainer}`] : ['-v', `${taskDir}:/var/task`])
      .concat(networkArg ? ['--network', `container:${parentContainer}`] : ['--network', 'host'])
      .concat(cleanUp ? ['--rm'] : [])
      .concat(addEnvVars ? ENV_ARGS : [])
      .concat(dockerArgs)
      .concat([dockerImage, handler, JSON.stringify(event)])

    console.log('args', args)

    const run = spawn('docker', args, spawnOptions)

    resolve(run)
  })
}

const runDocker = (run) => {
  log('run docker')
  return new BbPromise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    run.stdout.on('data', (data) => {
      const str = data.toString()
      log(str.replace(/\n$/, ''))
      stdout += str
    })

    run.stderr.on('data', (data) => {
      const str = data.toString()
      log(str.replace(/\n$/, ''))
      stderr += str
    })

    run.on('close', (code) => {
      const result = {
        code,
        stdout,
        stderr
      }

      if (code === 0) {
        resolve(result)
      } else {
        reject(result)
      }
    })
  })
}

module.exports = (opt) => {
  if (process.env.DOCKER) {
    log('docker')
    return getContainer()
      .then(function (parentContainer) {
        return getArgs(opt, parentContainer)
      })
      .then(function (run) {
        return runDocker(run)
      })
  } else {
    log('not docker')
    return getArgs(opt, '')
      .then(function (run) {
        return runDocker(run)
      })
  }
}
