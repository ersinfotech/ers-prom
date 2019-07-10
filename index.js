const onFinished = require('on-finished')
const Prometheus = require('prom-client')
const consul = require('consul')({
  promisify: true,
})

function requestDurationGenerator(buckets) {
  return new Prometheus.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['route', 'method', 'status'],
    buckets,
  })
}

module.exports = (app, options = {}, consulOptions) => {
  const {
    metricsPath = '/metrics',
    requestDurationBuckets = [1, 5, 10, 30, 60],
    includeDefault = true,
  } = options

  app.get(metricsPath, (req, res) => {
    res.set('Content-Type', Prometheus.register.contentType)
    res.end(Prometheus.register.metrics())
  })

  app.locals.Prometheus = Prometheus

  if (includeDefault) {
    Prometheus.collectDefaultMetrics()
  }

  const requestDuration = requestDurationGenerator(requestDurationBuckets)

  const red = (req, res, next) => {
    const end = requestDuration.startTimer()

    onFinished(res, () => {
      let { statusCode: status } = res
      let { graphqlUrl, baseUrl: route, method } = req

      if (graphqlUrl && route) route += graphqlUrl

      route = route || req.path

      end({ route, method, status })
    })

    next()
  }

  if (consulOptions) {
    consul.agent.service
      .register({
        name: consulOptions.name,
        tags: ['prometheus'],
        port: Number(consulOptions.port),
        check: {
          http: `http://127.0.0.1:${consulOptions.port}${metricsPath}`,
          interval: '1m',
          ttl: '2m',
          deregistercriticalserviceafter: '1m',
        },
      })
      .then(() => {
        console.log('success to register in consul')
      })
      .catch(err => {
        console.error('failure to register in consul')
      })
  }

  app.use(red)
}
