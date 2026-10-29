package cn.yingxiang.bootstrap;
import java.nio.file.*;
import java.util.TreeMap;
import tools.jackson.databind.json.JsonMapper;
/** 私有配置导出到受保护备份目录；不向stdout返回任何配置值。 */
public final class ExportPrivateConfiguration {
 public static void main(String[] args) {
  try {
   if(args.length!=2)throw new IllegalArgumentException();
   Path root=Path.of("backups").toAbsolutePath().normalize();
   Path target=Path.of(args[1]).toAbsolutePath().normalize();
   if(!target.startsWith(root))throw new IllegalArgumentException();
   for(Path parent=target;parent!=null;parent=parent.getParent())if(Files.isSymbolicLink(parent))throw new IllegalArgumentException();
   var config=ConnectionProbe.load(Path.of(args[0]));ConnectionProbe.validate(config);
   var values=new TreeMap<String,String>();for(String key:config.stringPropertyNames())values.put(key,config.getProperty(key));
   Files.createDirectories(target.getParent());
   Files.writeString(target,JsonMapper.builder().build().writeValueAsString(values),StandardOpenOption.CREATE_NEW);
   System.out.println("{\"ok\":true,\"valuesPrinted\":false}");
  } catch(Exception ignored){System.out.println("{\"ok\":false,\"code\":\"PRIVATE_EXPORT_FAILED\"}");System.exit(1);}
 }
}
