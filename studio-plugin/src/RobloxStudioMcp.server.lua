local HttpService = game:GetService("HttpService")
local StudioService = game:GetService("StudioService")

local BRIDGE_URL = "http://127.0.0.1:17483"
local BRIDGE_TOKEN = "" -- Set the same random token as ROBLOX_STUDIO_BRIDGE_TOKEN

local ALLOWED_CLASSES = {
	Part = true,
	SpawnLocation = true,
	ProximityPrompt = true,
	Folder = true,
	Model = true,
	ScreenGui = true,
	SurfaceGui = true,
	Frame = true,
	TextLabel = true,
	TextButton = true,
	UIListLayout = true,
	UIGridLayout = true,
	RemoteEvent = true,
	RemoteFunction = true,
	BindableEvent = true,
	Script = true,
	LocalScript = true,
	ModuleScript = true,
	Attachment = true,
	Decal = true,
	Highlight = true
}

local ALLOWED_PROPERTIES = {
	Name = true,
	Parent = true,
	Transparency = true,
	CanCollide = true,
	Anchored = true,
	Color = true,
	Size = true,
	Position = true,
	Enabled = true,
	Text = true,
	Visible = true,
	BrickColor = true,
	CFrame = true,
	Value = true
}

local function headers()
	return {
		["Content-Type"] = "application/json",
		["Authorization"] = "Bearer " .. BRIDGE_TOKEN
	}
end

local function post(path, payload)
	return HttpService:RequestAsync({
		Url = BRIDGE_URL .. path,
		Method = "POST",
		Headers = headers(),
		Body = HttpService:JSONEncode(payload)
	})
end

local function get(path)
	return HttpService:RequestAsync({
		Url = BRIDGE_URL .. path,
		Method = "GET",
		Headers = headers()
	})
end

local function findPath(args)
	local path = args.path or "game"
	local current = game
	for segment in string.gmatch(tostring(path), "[^%.]+") do
		if segment == "game" then
			current = game
		else
			current = current:FindFirstChild(segment)
			if not current then
				return nil
			end
		end
	end
	return current
end

local function serializeInstance(instance)
	local result = {
		name = instance.Name,
		className = instance.ClassName,
		path = instance:GetFullName(),
		children = {}
	}
	for _, child in instance:GetChildren() do
		table.insert(result.children, serializeInstance(child))
	end
	return result
end

local function execute(operation, args)
	args = args or {}
	if operation == "get_instance_tree" then
		local root = findPath(args) or game
		local maxDepth = math.clamp(tonumber(args.depth) or 4, 1, 8)
		local function tree(instance, depth)
			local node = { name = instance.Name, className = instance.ClassName, path = instance:GetFullName() }
			if depth > 0 then
				node.children = {}
				for _, child in instance:GetChildren() do
					table.insert(node.children, tree(child, depth - 1))
				end
			end
			return node
		end
		return tree(root, maxDepth)
	elseif operation == "get_instance_properties" then
		local instance = findPath(args)
		if not instance then
			return { error = "Instance not found" }
		end
		local properties = {}
		for name in pairs(ALLOWED_PROPERTIES) do
			local success, value = pcall(function()
				return instance[name]
			end)
			if success and value ~= nil then
				properties[name] = tostring(value)
			end
		end
		return properties
	elseif operation == "get_selection" then
		local Selection = game:GetService("Selection")
		local selected = {}
		for _, instance in Selection:Get() do
			table.insert(selected, serializeInstance(instance))
		end
		return selected
	elseif operation == "find_instances" then
		local root = findPath(args) or game
		local name = args.name
		local className = args.className
		local matches = {}
		for _, descendant in root:GetDescendants() do
			if (not name or descendant.Name:lower():find(tostring(name):lower(), 1, true))
				and (not className or descendant:IsA(tostring(className))) then
				table.insert(matches, { name = descendant.Name, className = descendant.ClassName, path = descendant:GetFullName() })
				if #matches >= 500 then
					break
				end
			end
		end
		return matches
	elseif operation == "create_instance" then
		if not ALLOWED_CLASSES[tostring(args.className)] then
			return { error = "Instance class is not allowlisted" }
		end
		local parent = findPath(args.parentPath) or workspace
		local instance = Instance.new(tostring(args.className))
		instance.Name = tostring(args.name or args.className)
		instance.Parent = parent
		return { name = instance.Name, className = instance.ClassName, path = instance:GetFullName() }
	elseif operation == "update_instance" then
		local instance = findPath(args)
		if not instance then
			return { error = "Instance not found" }
		end
		for name, value in pairs(args.properties or {}) do
			if not ALLOWED_PROPERTIES[name] then
				return { error = "Property is not allowlisted: " .. tostring(name) }
			end
			local success, result = pcall(function()
				instance[name] = value
			end)
			if not success then
				return { error = "Could not update property: " .. tostring(result) }
			end
		end
		return { updated = true, path = instance:GetFullName() }
	elseif operation == "delete_instance" then
		if args.confirm ~= true then
			return { error = "Deletion requires confirm=true" }
		end
		local instance = findPath(args)
		if not instance then
			return { error = "Instance not found" }
		end
		instance:Destroy()
		return { deleted = true }
	elseif operation == "get_output" or operation == "get_errors" or operation == "get_warnings" then
		return { unavailable = "Studio output capture is not connected by this plugin version" }
	elseif operation == "get_test_status" then
		return { unavailable = "Studio TestService plugin integration is not configured" }
	end
	return { error = "Unknown operation: " .. tostring(operation) }
end

if BRIDGE_TOKEN == "" then
	warn("[RobloxMCP] Set BRIDGE_TOKEN to the same value as ROBLOX_STUDIO_BRIDGE_TOKEN")
else
	task.spawn(function()
		while true do
			pcall(post, "/plugin/ping", {})
			local response = get("/studio/request")
			if response.Success then
				local decoded = HttpService:JSONDecode(response.Body)
				if decoded.request then
					local request = decoded.request
					local success, result = pcall(execute, request.operation, request.args)
					if not success then
						result = { error = tostring(result) }
					end
					pcall(post, "/studio/result", { id = request.id, result = result })
				end
			end
			task.wait(0.5)
		end
	end)
end
