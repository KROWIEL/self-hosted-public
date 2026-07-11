# Java web app (Maven → WAR → Tomcat) build template.
# Multi-stage: build the WAR from source with Maven, then deploy it to Tomcat 9
# at the ROOT context (served at "/"). Tomcat 9 keeps the javax.servlet
# namespace, which most classic Maven web apps target.

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY . .
RUN mvn -q -DskipTests package

FROM tomcat:9.0
RUN rm -rf /usr/local/tomcat/webapps/*
COPY --from=build /app/target/*.war /usr/local/tomcat/webapps/ROOT.war
EXPOSE 8080
CMD ["catalina.sh", "run"]
