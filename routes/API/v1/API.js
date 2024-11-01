const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { sendPasswordResetEmail } = require('../../../handlers/email.js');
const { db } = require('../../../handlers/db.js');
const log = new (require('cat-loggr'))();

const saltRounds = 10;



/**
 * Middleware function to validate the API key provided in the request headers.
 * 
 * Checks for the presence of an 'x-api-key' header in the incoming request. 
 * If the header is missing, responds with a 401 status code and an error message.
 * 
 * Retrieves the list of valid API keys from the database and verifies if the provided
 * API key exists in the list. If the key is invalid, responds with a 401 status code.
 * 
 * If the API key is valid, attaches it to the request object and calls the next middleware.
 * 
 * Logs any errors encountered during the process and responds with a 500 status code
 * in case of a server error.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is required' });
  }

  try {
    const apiKeys = await db.get('apiKeys') || [];
    const validKey = apiKeys.find(key => key.key === apiKey);

    if (!validKey) {
      return res.status(401).json({ error: 'API Key Invalid' });
    }

    req.apiKey = validKey;
    next();
  } catch (error) {
    log.error('Error validating API key:', error);
    res.status(500).json({ error: 'Failed to validate API key' });
  }
}

/**
 * GET /api/v1/users/:type?/:value?
 *
 * Retrieves a list of users or a specific user based on the provided type and value. If no type or value is provided, returns all users.
 *
 * @param {string} type - The type of user to retrieve. Can be 'email' or 'username'.
 * @param {string} value - The value of the user to retrieve. Only required if type is 'email' or 'username'.
 * @returns {Object} The retrieved user object.
 */
router.get('/api/v1/users/:type?/:value?', validateApiKey, async (req, res) => {
  try {
    const { type, value } = req.params;
    const users = await db.get('users') || [];

    // If both type and value are provided, search for a specific user
    if (type && value) {
      let user;

      if (type === 'email') {
        user = users.find(user => user.email === value);
      } else if (type === 'username') {
        user = users.find(user => user.username === value);
      } else {
        return res.status(400).json({ error: 'Invalid search type. Use "email" or "username".' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json(user);
    }

    // If no type or value, return all users
    res.json(users);
  } catch (error) {
    log.error('Error retrieving users:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

/**
 * POST /api/v1/user/:userId/instances
 *
 * Retrieves a list of instances for a specific user
 *
 * @param {string} userId - The ID of the user to retrieve instances for
 * @returns {Object} The retrieved instances object
 */
router.post('/api/v1/user/:userId/instances', validateApiKey, async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'Parameter "userId" is required' });
  }

  try {
    const users = await db.get('users') || [];
    const userExists = users.some(user => user.userId === userId);

    if (!userExists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userInstances = await db.get(`${userId}_instances`) || [];
    res.json(userInstances);
  } catch (error) {
    log.error('Error retrieving user instances:', error);
    res.status(500).json({ error: 'Failed to retrieve user instances' });
  }
});

/** 
 * POST /api/v1/user/create-user
 *
 * Creates a new user
 *
 * @param {string} username - The username of the new user
 * @param {string} email - The email of the new user
 * @param {string} password - The password of the new user
 * @param {string} userId - The ID of the new user
 * @param {boolean} admin - The admin status of the new user
 * @returns {Object} The created user object
 */
router.post('/api/v1/user/create-user', validateApiKey, async (req, res) => {
  try {
    const { username, email, password, userId, admin } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const users = await db.get('users') || [];
    const userExists = users.some(user => user.username === username || user.email === email);

    if (userExists) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const newUserId = userId || uuidv4();

    const user = {
      userId: newUserId,
      username,
      email,
      password: await bcrypt.hash(password, saltRounds),
      accessTo: [],
      admin: admin === true
    };

    users.push(user);
    await db.set('users', users);

    res.status(201).json({ userId: newUserId, username, email, admin: user.admin });
  } catch (error) {
    log.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * POST /api/v1/user/:email/reset-password
 *
 * Sends a password reset email
 *
 * @param {string} email - The email of the user
 * @returns {Object} The password reset token
 */
router.post('/api/v1/user/:email/reset-password', validateApiKey, async (req, res) => {
  const { email } = req.body;

  try {
    const users = await db.get('users') || [];
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const resetToken = generateRandomCode(30);
    user.resetToken = resetToken;
    await db.set('users', users);

    const smtpSettings = await db.get('smtp_settings');
    if (smtpSettings) {
      await sendPasswordResetEmail(email, resetToken);
      res.status(200).json({ message: `Password reset email sent successfully (${resetToken})` });
    } else {
      res.status(200).json({ password: resetToken });
    }
  } catch (error) {
    log.error('Error handling password reset:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * POST /api/v1/instances/suspend/:id
 *
 * Suspends an instance
 *
 * @param {string} id - The ID of the instance to suspend
 * @returns {Object} The updated instance object
 */
router.post('/api/v1/instances/suspend/:id', validateApiKey, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const instance = await db.get(id + '_instance');
    if (!instance) {
      return res.status(404).send('Instance not found');
    }

    instance.suspended = true;
    await db.set(id + '_instance', instance);
    let instances = await db.get('instances') || [];

    let instanceToSuspend = instances.find(obj => obj.ContainerId === instance.ContainerId);
    if (instanceToSuspend) {
      instanceToSuspend.suspended = true;
    }

    await db.set('instances', instances);

    logAudit(req.user.userId, req.user.username, 'instance:suspend', req.ip);
    res.status(201).json({ success: 'Instance Suspended Successfully' });
  } catch (error) {
    log.error('Error in suspend instance:', error);
    res.status(500).send('An error occurred while suspending the instance');
  }
});

/**
 * POST /api/v1/instances/unsuspend/:id
 *
 * Unsuspends an instance
 *
 * @param {string} id - The ID of the instance to unsuspend
 * @returns {Object} The updated instance object
 */
router.post('/api/v1/instances/unsuspend/:id', validateApiKey, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const instance = await db.get(id + '_instance');
    if (!instance) {
      return res.status(404).send('Instance not found');
    }

    instance.suspended = false;

    await db.set(id + '_instance', instance);

    let instances = await db.get('instances') || [];

    let instanceToUnsuspend = instances.find(obj => obj.ContainerId === instance.ContainerId);
    if (instanceToUnsuspend) {
      instanceToUnsuspend.suspended = false;
    }
    
    if (instanceToUnsuspend['suspended-flagg']) {
      delete instanceToUnsuspend['suspended-flagg'];
    }

    await db.set('instances', instances);

    logAudit(req.user.userId, req.user.username, 'instance:unsuspend', req.ip);

    res.status(201).json({ success: 'Instance Suspended Successfully' });
  } catch (error) {
    log.error('Error in unsuspend instance :', error);
    res.status(500).send('An error occurred while unsuspending the instance');
  }
});

/**
 * GET /api/v1/instances
 *
 * Retrieves all instances
 *
 * @returns {Object} The list of instances
 */
router.get('/api/v1/instances', validateApiKey, async (req, res) => {
  try {
    const instances = await db.get('instances') || [];
    res.json(instances);
  } catch (error) {
    log.error('Error retrieving instances:', error);
    res.status(500).json({ error: 'Failed to retrieve instances' });
  }
});

/**
 * POST /api/v1/instances/deploy
 *
 * Deploys an instance
 *
 * @param {string} image - The image to deploy
 * @param {string} imagename - The name of the image
 * @param {number} memory - The memory of the instance
 * @param {number} cpu - The cpu of the instance
 * @param {string} ports - The ports to expose
 * @param {string} nodeId - The node to deploy on
 * @param {string} name - The name of the instance
 * @param {string} user - The user to deploy as
 * @param {boolean} primary - The primary status of the instance
 * @returns {Object} The created instance object
 */
router.post('/api/v1/instances/deploy', validateApiKey, async (req, res) => {
  const { image, imagename, memory, cpu, ports, nodeId, name, user, primary, variables } = req.body;

  if (!image || !imagename || !memory || !cpu || !ports || !nodeId || !name || !user || primary === undefined) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const Id = uuidv4().split('-')[0];
    const node = await db.get(`${nodeId}_node`);
    if (!node) {
      return res.status(404).json({ error: 'Invalid node' });
    }

    const requestData = await prepareRequestData(
      image,
      memory,
      cpu,
      ports,
      name,
      node,
      Id,
      variables || [],
      imagename
    );

    const response = await axios(requestData);

    await updateDatabaseWithNewInstance(
      response.data,
      user,
      node,
      image,
      memory,
      cpu,
      ports,
      primary,
      name,
      Id,
      imagename
    );

    // Start checking the container state asynchronously
    checkContainerState(Id, node.address, node.port, node.apiKey, user);

    res.status(201).json({
      message: "Container creation initiated. State will be updated asynchronously.",
      volumeId: Id,
      state: 'INSTALLING',
    });
  } catch (error) {
    log.error('Error deploying instance:', error);
    res.status(500).json({
      error: 'Failed to create container',
      details: error.response ? error.response.data : 'No additional error info',
    });
  }
});

/**
 * DELETE /api/v1/instance/delete
 *
 * Deletes an instance
 *
 * @param {string} id - The id of the instance
 * @returns {Object} The deleted instance
 */
router.delete('/api/v1/instance/:id/delete', validateApiKey, async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'Missing ID parameter' });
  }
  
  try {
    const instance = await db.get(id + '_instance');
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    await deleteInstance(instance);
    res.status(200).json({ message: 'The instance has been successfully deleted.' });
  } catch (error) {
    log.error('Error deleting instance:', error);
    res.status(500).json({ error: 'Failed to delete instance' });
  }
});

/**
 * GET /api/v1/instance/:id
 *
 * Retrieves an instance
 *
 * @param {string} id - The id of the instance
 * @returns {Object} The retrieved instance
 */
router.post('/api/v1/instance/:id', validateApiKey, async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Parameter "id" is required' });
  }

  try {
    const instances = await db.get('instances') || [];
    const instanceExists = instances.some(instance => instance.Id === id);

    if (!instanceExists) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    const instance = await db.get(id + '_instance');
    res.json(instance);
  } catch (error) {
    log.error('Error retrieving instance:', error);
    res.status(500).json({ error: 'Failed to retrieve instance' });
  }
});

/** 
 * GET /api/v1/images
 *
 * Retrieves all images
 *
 * @returns {Object} The retrieved images
 */
router.get('/api/v1/images', validateApiKey, async (req, res) => {
  try {
    const images = await db.get('images') || [];
    res.json(images);
  } catch (error) {
    log.error('Error retrieving images:', error);
    res.status(500).json({ error: 'Failed to retrieve images' });
  }
});

/**
 * GET /api/v1/name
 *
 * Retrieves the name
 *
 * @returns {Object} The retrieved name
 */
router.get('/api/v1/name', validateApiKey, async (req, res) => {
  try {
    const name = await db.get('name') || 'Skyport';
    res.json({ name });
  } catch (error) {
    log.error('Error retrieving name:', error);
    res.status(500).json({ error: 'Failed to retrieve name' });
  }
});

/**
 * GET /api/v1/nodes
 *
 * Retrieves all nodes
 *
 * @returns {Object} The retrieved nodes
 */
router.get('/api/v1/nodes', validateApiKey, async (req, res) => {
  try {
    const nodes = await db.get('nodes') || [];
    const nodeDetails = await Promise.all(nodes.map(id => db.get(id + '_node')));
    res.json(nodeDetails);
  } catch (error) {
    log.error('Error retrieving nodes:', error);
    res.status(500).json({ error: 'Failed to retrieve nodes' });
  }
});

/**
 * POST /api/v1/nodes/create
 *
 * Creates a new node
 *
 * @param {string} name - The name of the node
 * @param {string} tags - The tags of the node
 * @param {string} ram - The RAM of the node
 * @param {string} disk - The disk of the node
 * @param {string} processor - The processor of the node
 * @param {string} address - The address of the node
 * @param {string} port - The port of the node
 * @returns {Object} The created node
 */
router.post('/api/v1/nodes/create', validateApiKey, async (req, res) => {
  const node = {
    id: uuidv4(),
    name: req.body.name,
    tags: req.body.tags,
    ram: req.body.ram,
    disk: req.body.disk,
    processor: req.body.processor,
    address: req.body.address,
    port: req.body.port,
    apiKey: null, // Set to null initially
    configureKey: configureKey, // Add the configureKey
    status: 'Unconfigured' // Status to indicate pending configuration
  };

  if (!req.body.name || !req.body.tags || !req.body.ram || !req.body.disk || !req.body.processor || !req.body.address || !req.body.port) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  await db.set(node.id + '_node', node); // Save the initial node info
  const updatedNode = await checkNodeStatus(node); // Check and update status

  const nodes = await db.get('nodes') || [];
  nodes.push(node.id);
  await db.set('nodes', nodes);

  res.status(201).json({ Message: updatedNode });
});

/**
 * DELETE /api/v1/nodes/:id/delete
 *
 * Deletes a node
 *
 * @param {string} id - The id of the node
 * @returns {Object} The deleted node
 */
router.delete('/api/v1/nodes/:id/delete', validateApiKey, async (req, res) => {
  const { id } = req.params;
  const nodes = await db.get('nodes') || [];
  const newNodes = nodes.filter(id => id !== id);

  if (!id) return res.send('The node ID was invalid');

  await db.set('nodes', newNodes);
  await db.delete(id + '_node');

  res.status(201).json({ Message: "The node has successfully deleted." });
});

/*** Helper Functions ***/
function generateRandomCode(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Helper function to delete an instance
async function deleteInstance(instance) {
  try {
    await axios.get(`http://Skyport:${instance.Node.apiKey}@${instance.Node.address}:${instance.Node.port}/instances/${instance.ContainerId}/delete`);
    
    // Update user's instances
    let userInstances = await db.get(instance.User + '_instances') || [];
    userInstances = userInstances.filter(obj => obj.ContainerId !== instance.ContainerId);
    await db.set(instance.User + '_instances', userInstances);
    
    // Update global instances
    let globalInstances = await db.get('instances') || [];
    globalInstances = globalInstances.filter(obj => obj.ContainerId !== instance.ContainerId);
    await db.set('instances', globalInstances);
    
    // Delete instance-specific data
    await db.delete(instance.ContainerId + '_instance');
  } catch (error) {
    log.error(`Error deleting instance ${instance.ContainerId}:`, error);
    throw error;
  }
}

/**
 * Checks the operational status of a node by making an HTTP request to its API.
 * Updates the node's status based on the response or sets it as 'Offline' if the request fails.
 * This status check and update are persisted in the database.
 *
 * @param {Object} node - The node object containing details such as address, port, and API key.
 * @returns {Promise<Object>} Returns the updated node object after attempting to verify its status.
 */
async function checkNodeStatus(node) {
  try {
    const RequestData = {
      method: 'get',
      url: 'http://' + node.address + ':' + node.port + '/',
      auth: {
        username: 'Skyport',
        password: node.apiKey
      },
      headers: { 
        'Content-Type': 'application/json'
      }
    };
    const response = await axios(RequestData);
    const { versionFamily, versionRelease, online, remote, docker } = response.data;

    node.status = 'Online';
    node.versionFamily = versionFamily;
    node.versionRelease = versionRelease;
    node.remote = remote;
    node.docker = docker;

    await db.set(node.id + '_node', node); // Update node info with new details
    return node;
  } catch (error) {
    node.status = 'Offline';
    await db.set(node.id + '_node', node); // Update node as offline if there's an error
    return node;
  }
}

/**
 * Checks the state of a container and updates the database accordingly.
 * @param {string} volumeId - The ID of the volume.
 * @param {string} nodeAddress - The address of the node.
 * @param {string} nodePort - The port of the node.
 * @param {string} apiKey - The API key for authentication.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<void>}
 */
async function checkContainerState(volumeId, nodeAddress, nodePort, apiKey, userId) {
  let attempts = 0;
  const maxAttempts = 50;
  const delay = 30000; // 30 seconds

  const checkState = async () => {
    try {
      const response = await axios({
        method: 'get',
        url: `http://${nodeAddress}:${nodePort}/state/${volumeId}`,
        auth: {
          username: 'Skyport',
          password: apiKey,
        },
      });

      const { state, containerId } = response.data;
      await updateInstanceState(volumeId, state, containerId, userId);

      if (state === 'READY') {
        return;
      }

      if (++attempts < maxAttempts) {
        setTimeout(checkState, delay);
      } else {
        log.info(`Container ${volumeId} failed to become active after ${maxAttempts} attempts.`);
        await updateInstanceState(volumeId, 'FAILED', containerId, userId);
      }
    } catch (error) {
      log.error(`Error checking state for container ${volumeId}:`, error);
      if (++attempts < maxAttempts) {
        setTimeout(checkState, delay);
      } else {
        log.info(`Container ${volumeId} state check failed after ${maxAttempts} attempts.`);
        await updateInstanceState(volumeId, 'FAILED', null, userId);
      }
    }
  };

  checkState();
}

async function updateInstanceState(volumeId, state, containerId, userId) {
  const instance = await db.get(`${volumeId}_instance`);
  if (instance) {
    instance.InternalState = state;
    instance.ContainerId = containerId;
    await db.set(`${volumeId}_instance`, instance);

    const userInstances = await db.get(`${userId}_instances`) || [];
    const updatedUserInstances = userInstances.map(i => 
      i.Id === volumeId ? { ...i, InternalState: state, ContainerId: containerId } : i
    );
    await db.set(`${userId}_instances`, updatedUserInstances);

    const globalInstances = await db.get('instances') || [];
    const updatedGlobalInstances = globalInstances.map(i => 
      i.Id === volumeId ? { ...i, InternalState: state, ContainerId: containerId } : i
    );
    await db.set('instances', updatedGlobalInstances);
  }
}

async function prepareRequestData(image, memory, cpu, ports, name, node, Id, variables, imagename) {
  const rawImages = await db.get('images') || [];
  const imageData = rawImages.find(i => i.Name === imagename);

  const requestData = {
    method: 'post',
    url: `http://${node.address}:${node.port}/instances/create`,
    auth: {
      username: 'Skyport',
      password: node.apiKey,
    },
    headers: {
      'Content-Type': 'application/json',
    },
    data: {
      Name: name,
      Id,
      Image: image,
      Env: imageData ? imageData.Env : undefined,
      Scripts: imageData ? imageData.Scripts : undefined,
      Memory: parseInt(memory),
      Cpu: parseInt(cpu),
      ExposedPorts: {},
      PortBindings: {},
      variables,
      AltImages: imageData ? imageData.AltImages : [],
      StopCommand: imageData ? imageData.StopCommand : undefined,
    },
  };

  // Process port mappings
  if (ports) {
    ports.split(',').forEach(portMapping => {
      const [containerPort, hostPort] = portMapping.split(':');

      // Adds support for TCP
      const tcpKey = `${containerPort}/tcp`;
      if (!requestData.data.ExposedPorts[tcpKey]) {
        requestData.data.ExposedPorts[tcpKey] = {};
      }

      if (!requestData.data.PortBindings[tcpKey]) {
        requestData.data.PortBindings[tcpKey] = [{ HostPort: hostPort }];
      }

      // Adds support for UDP
      const udpKey = `${containerPort}/udp`;
      if (!requestData.data.ExposedPorts[udpKey]) {
        requestData.data.ExposedPorts[udpKey] = {};
      }

      if (!requestData.data.PortBindings[udpKey]) {
        requestData.data.PortBindings[udpKey] = [{ HostPort: hostPort }];
      }
    });
  }

  return requestData;
}

async function updateDatabaseWithNewInstance(
  responseData,
  userId,
  node,
  image,
  memory,
  cpu,
  ports,
  primary,
  name,
  Id,
  imagename
) {
  const rawImages = await db.get('images') || [];
  const imageData = rawImages.find(i => i.Name === imagename);

  const instanceData = {
    Name: name,
    Id,
    Node: node,
    User: userId,
    InternalState: 'INSTALLING',
    ContainerId: responseData.containerId,
    VolumeId: Id,
    Memory: parseInt(memory),
    Cpu: parseInt(cpu),
    Ports: ports,
    Primary: primary,
    Image: image,
    AltImages: imageData ? imageData.AltImages : [],
    StopCommand: imageData ? imageData.StopCommand : undefined,
    imageData,
    Env: responseData.Env,
  };

  const userInstances = await db.get(`${userId}_instances`) || [];
  userInstances.push(instanceData);
  await db.set(`${userId}_instances`, userInstances);

  const globalInstances = await db.get('instances') || [];
  globalInstances.push(instanceData);
  await db.set('instances', globalInstances);

  await db.set(`${Id}_instance`, instanceData);
}

module.exports = router;