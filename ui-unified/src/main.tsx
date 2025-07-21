import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Amplify } from 'aws-amplify'
import '@cloudscape-design/global-styles/index.css'
import App from './App'

// Load runtime configuration
async function getRuntimeConfig() {
  try {
    const response = await fetch('/runtimeConfig.json')
    return await response.json()
  } catch (error) {
    console.error('Failed to load runtime config:', error)
    return null
  }
}

function constructAmplifyConfig(config: any) {
  if (!config) return {}
  
  if (config.ApiEndpoint.endsWith('/')) {
    config.ApiEndpoint = config.ApiEndpoint.slice(0, -1)
  }

  return {
    Auth: {
      Cognito: {
        userPoolId: config.UserPoolId,
        userPoolClientId: config.UserPoolClientId,
        // OAuth handled manually
      }
    },
    API: {
      REST: {
        api: {
          endpoint: config.ApiEndpoint,
          region: config.AwsRegion
        }
      }
    }
  }
}

getRuntimeConfig().then(async (config) => {
  if (config) {
    const amplifyConfig = constructAmplifyConfig(config)
    Amplify.configure(amplifyConfig)
  }
  
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App runtimeConfig={config} />
      </BrowserRouter>
    </React.StrictMode>,
  )
})
