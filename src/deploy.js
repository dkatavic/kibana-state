const elasticsearch = require('elasticsearch')
const { addItem, getEsState, removeItem, updateItem } = require('./es')
const { getState } = require('./get-state')
const { initialize } = require('./initialize')
const debug = require('debug')('deploy')
const CHECKSUM_KEY = 'tr-checksum'

const isVersioned = (item) => item._source && item._source.config && item._source.config[CHECKSUM_KEY]
const isConfig = (item) => item._source.type !== 'config'

async function doUpdates (esClient, newState, currentState, dryRun) {
  let created = removed = updated = 0

  newState.forEach(async newItem => {
    const newChecksum = newItem._source.config[CHECKSUM_KEY]
    const existingItem = currentState.find(oldItem => oldItem._id === newItem._id)

    if (existingItem) {
      const existingChecksum = existingItem._source.config && existingItem._source.config[CHECKSUM_KEY]
      if (newChecksum !== existingChecksum) {
        updated++
        if (!dryRun) {
          await updateItem(esClient, newItem)
        }
      }
    } else {
      created++
      if (!dryRun) {
        await addItem(esClient, newItem)
      }
    }
  })
  currentState.filter(isVersioned).forEach(async item => {
    const itemRemoved = newState.find(newItem => newItem._id === item._id)
    if (!itemRemoved) {
      removed++
      if (!dryRun) {
        await removeItem(esClient, item)
      }
    }
  })
  return { created, removed, updated }
}

async function deploy ({
  stateFilePath,
  kibanaIndexName,
  host,
  port,
  dryRun = false
}) {
  debug('Deploying Kibana Dashboard')
  const elasticUrl = `${host}:${port}`
  const esClient = await new elasticsearch.Client({
    host: elasticUrl,
    apiVersion: '6.2',
    log: 'error'
  })
  const targetState = await getState(stateFilePath, { kibanaIndexName })
  await initialize({
    esClient,
    kibanaIndexName,
    state: targetState,
    dryRun
  })
  const targetStateFiltered = targetState.filter(isConfig)
  const esState = await getEsState(esClient, { kibanaIndexName })
  const currentState = esState.hits.hits.filter(item => isConfig(item))
  const { created, removed, updated } = await doUpdates(esClient, targetStateFiltered, currentState, dryRun)
  console.log(`created ${created}, removed ${removed}, updated ${updated}`)
}

module.exports = {
  deploy,
  doUpdates
}
