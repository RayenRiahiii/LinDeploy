import yaml


class LiteralSecret(str):
    """Ansible must never template a credential, even if it contains Jinja."""


class InventoryDumper(yaml.SafeDumper):
    pass


class InventoryLoader(yaml.SafeLoader):
    pass


InventoryDumper.add_representer(LiteralSecret, lambda dumper, value:
                                dumper.represent_scalar("!unsafe", str(value), style='"'))
InventoryLoader.add_constructor("!unsafe", lambda loader, node: loader.construct_scalar(node))


def dump_inventory(value):
    return yaml.dump(value, Dumper=InventoryDumper, default_flow_style=False, sort_keys=False)


def redact_inventory(value):
    try:
        parsed = yaml.load(value, Loader=InventoryLoader)
    except yaml.YAMLError:
        return "<inventory omitted: invalid or unsupported YAML>"

    def scrub(item):
        if isinstance(item, dict):
            return {key: ("<redacted>" if str(key).lower() in {
                "ansible_password", "ansible_become_password", "ansible_ssh_pass",
                "ansible_become_pass", "password", "private_key", "become_password",
            } else scrub(child)) for key, child in item.items()}
        if isinstance(item, list):
            return [scrub(child) for child in item]
        return item

    return yaml.safe_dump(scrub(parsed), sort_keys=False)
