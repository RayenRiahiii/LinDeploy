from django.contrib import admin

from .models import (
    Credential,
    Host,
    Installation,
    InstallationTarget,
    InstallationTemplate,
)


@admin.register(Credential)
class CredentialAdmin(admin.ModelAdmin):
    list_display = ("name", "auth_type", "username", "created_at")
    search_fields = ("name", "username")


@admin.register(Host)
class HostAdmin(admin.ModelAdmin):
    list_display = ("name", "ip_address", "ssh_port", "node_role", "os_type", "enabled", "credential")
    list_filter = ("enabled", "node_role", "os_type")
    search_fields = ("name", "hostname", "ip_address")


@admin.register(InstallationTemplate)
class InstallationTemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "system_type", "deployment_type", "playbook_path", "created_at")
    list_filter = ("system_type", "deployment_type",)
    search_fields = ("name", "playbook_path", "system_type")


class InstallationTargetInline(admin.TabularInline):
    model = InstallationTarget
    extra = 0


@admin.register(Installation)
class InstallationAdmin(admin.ModelAdmin):
    list_display = ("id", "template", "status", "phase", "progress", "started_at", "finished_at", "created_at")
    list_filter = ("status", "phase", "template")
    inlines = [InstallationTargetInline]


@admin.register(InstallationTarget)
class InstallationTargetAdmin(admin.ModelAdmin):
    list_display = ("installation", "host", "status", "return_code", "created_at")
    list_filter = ("status",)
    search_fields = ("host__name",)
