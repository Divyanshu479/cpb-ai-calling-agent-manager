import axios from 'axios';
import Handlebars from 'handlebars';
import { JSONPath } from 'jsonpath-plus';
import FormData from 'form-data';
import Integration from '../models/Integration.js';

class IntegrationExecutor {

  /**
   * Execute an integration with given input data
   * @param {string} integrationId - The integration ID
   * @param {object} inputData - Input data for the integration
   * @returns {Promise<object>} - Result object with success, data, and optional usage
   */
  async execute(integrationId, inputData) {
    const integration = await Integration.findById(integrationId);

    if (!integration || !integration.isActive) {
      throw new Error('Integration not found or inactive');
    }

    const config = this.buildRequestConfig(integration, inputData);

    let attempts = 0;
    let lastError = null;

    while (attempts <= integration.retryAttempts) {
      try {
        const response = await axios(config);
        return this.parseResponse(integration, response);
      } catch (error) {
        lastError = error;
        attempts++;

        // If it's the last attempt, handle the error
        if (attempts > integration.retryAttempts) {
          return this.handleError(integration, error);
        }

        // Wait before retrying (exponential backoff)
        await this.sleep(Math.min(1000 * Math.pow(2, attempts), 10000));
      }
    }

    return this.handleError(integration, lastError);
  }

  /**
   * Build axios request configuration
   */
  buildRequestConfig(integration, inputData) {
    const config = {
      method: integration.requestMethod,
      url: integration.baseUrl,
      timeout: integration.timeout,
      headers: this.buildHeaders(integration),
      responseType: integration.responseType === 'binary' ? 'arraybuffer' : 'json'
    };

    // Build request body from template
    if (integration.requestBodyTemplate && ['POST', 'PUT', 'PATCH'].includes(integration.requestMethod)) {
      const template = Handlebars.compile(integration.requestBodyTemplate);
      const bodyString = template(inputData);

      if (integration.contentType === 'application/json') {
        try {
          config.data = JSON.parse(bodyString);
        } catch (e) {
          throw new Error(`Failed to parse request body template as JSON: ${e.message}`);
        }
      } else if (integration.contentType === 'multipart/form-data') {
        const parsedBody = JSON.parse(bodyString);
        config.data = this.buildFormData(parsedBody, inputData);
        // Remove Content-Type header to let axios set it with boundary
        delete config.headers['Content-Type'];
      } else {
        config.data = bodyString;
      }
    }

    return config;
  }

  /**
   * Build request headers including authentication
   */
  buildHeaders(integration) {
    const headers = {};

    // Add custom headers
    if (integration.requestHeaders) {
      integration.requestHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    }

    // Add authentication
    switch (integration.authType) {
      case 'bearer_token':
        if (integration.authConfig?.token) {
          headers['Authorization'] = `Bearer ${integration.authConfig.token}`;
        }
        break;

      case 'api_key_header':
        if (integration.authConfig?.headerName && integration.authConfig?.headerValue) {
          headers[integration.authConfig.headerName] = integration.authConfig.headerValue;
        }
        break;

      case 'basic_auth':
        if (integration.authConfig?.username && integration.authConfig?.password) {
          const credentials = Buffer.from(
            `${integration.authConfig.username}:${integration.authConfig.password}`
          ).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
        }
        break;

      case 'custom_header':
        if (integration.authConfig?.headerName && integration.authConfig?.headerValue) {
          headers[integration.authConfig.headerName] = integration.authConfig.headerValue;
        }
        break;

      case 'none':
      default:
        // No authentication
        break;
    }

    // Set content type (unless it's multipart/form-data, which axios handles)
    if (integration.contentType && integration.contentType !== 'multipart/form-data') {
      headers['Content-Type'] = integration.contentType;
    }

    return headers;
  }

  /**
   * Build FormData for multipart requests
   */
  buildFormData(bodyObj, inputData) {
    const formData = new FormData();

    for (const [key, value] of Object.entries(bodyObj)) {
      if (key === '__file' && inputData.fileBuffer) {
        // Handle file upload
        formData.append(
          value,
          inputData.fileBuffer,
          { filename: inputData.fileName || 'file' }
        );
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested objects/arrays as JSON
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, value);
      }
    }

    return formData;
  }

  /**
   * Parse response based on integration configuration
   */
  parseResponse(integration, response) {
    const { responseMapping, responseType } = integration;

    if (responseType === 'binary') {
      return {
        success: true,
        data: response.data,
        contentType: response.headers['content-type']
      };
    }

    let result = response.data;

    // Extract result using JSONPath if specified
    if (responseMapping?.resultPath) {
      try {
        const extracted = JSONPath({ path: responseMapping.resultPath, json: response.data });
        result = extracted.length === 1 ? extracted[0] : extracted;
      } catch (e) {
        console.warn(`Failed to extract result using JSONPath ${responseMapping.resultPath}:`, e.message);
      }
    }

    // Extract usage information if specified
    let usage = null;
    if (responseMapping?.usagePath) {
      try {
        const usageData = JSONPath({ path: responseMapping.usagePath, json: response.data });
        usage = usageData.length === 1 ? usageData[0] : usageData;
      } catch (e) {
        console.warn(`Failed to extract usage using JSONPath ${responseMapping.usagePath}:`, e.message);
      }
    }

    return { success: true, data: result, usage };
  }

  /**
   * Handle error responses
   */
  handleError(integration, error) {
    let errorMessage = error.message;

    if (error.response && integration.responseMapping?.errorPath) {
      try {
        const extracted = JSONPath({
          path: integration.responseMapping.errorPath,
          json: error.response.data
        });
        if (extracted.length > 0) {
          errorMessage = extracted[0];
        }
      } catch (e) {
        console.warn('Failed to extract error message from response:', e.message);
      }
    } else if (error.response) {
      // Try to get error from common locations
      errorMessage = error.response.data?.error
        || error.response.data?.message
        || error.response.statusText
        || error.message;
    }

    return { success: false, error: errorMessage };
  }

  /**
   * Sleep utility for retry backoff
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
const integrationExecutor = new IntegrationExecutor();
export default integrationExecutor;
